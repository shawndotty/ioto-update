#!/usr/bin/env node
/**
 * Obsidian 插件「GitHub + Gitee」一键发版脚本（可跨插件复用）
 *
 * 用法（在任意插件目录下执行）：
 *   npm run build:deploy                     # 构建 + 打包 + 打 tag + 发布到 GitHub 与 Gitee
 *   npm run build:deploy -- --dry-run        # 只预览将执行的命令，不产生任何副作用
 *   npm run build:deploy -- --github-only    # 只发 GitHub
 *   npm run build:deploy -- --gitee-only     # 只发 Gitee
 *   npm run build:deploy -- --notes "修复 X" # 指定 Release Note
 *   npm run build:deploy -- --notes-file ./notes.md
 *   npm run build:deploy -- --force          # tag / Release 已存在时覆盖
 *
 * 授权：
 *   - GitHub：复用已登录的 `gh`（token scopes 含 repo），无需额外配置。
 *   - Gitee：需要个人访问令牌，优先读环境变量 GITEE_TOKEN，其次读本地文件 .gitee-token。
 *     令牌只用于调用 Gitee OpenAPI，不会写入任何被提交的文件。
 *
 * 约定：
 *   - 版本号变更（package.json / manifest.json / versions.json）由用户在发版前手动提交，
 *     本脚本不会自动 `git commit`。
 *   - Gitee 走「方案 A」：若本地没有 gitee remote 则自动新增，并把当前分支与 tag 推送到 Gitee。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- 平台常量（全库统一，无需修改） ----
const GITEE_OWNER = "johnnylearns";
const GITEE_API = "https://gitee.com/api/v5";
const GITEE_REMOTE = "gitee";
const ASSETS = ["main.js", "manifest.json", "styles.css"];

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const c = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
};

const log = {
	step: (m) => console.log(`\n${c.cyan}${c.bold}▶ ${m}${c.reset}`),
	info: (m) => console.log(`  ${m}`),
	ok: (m) => console.log(`  ${c.green}✓${c.reset} ${m}`),
	warn: (m) => console.log(`  ${c.yellow}!${c.reset} ${m}`),
	err: (m) => console.error(`  ${c.red}✗${c.reset} ${m}`),
	cmd: (m) => console.log(`  ${c.dim}$ ${m}${c.reset}`),
};

// ---- 仓库标识（自动从 origin 推导，无需修改） ----
// 命名以 git remote 的仓库名为准，不要用 manifest.json 的 id
// （例如 slidesrup 的 id 是 slides-rup，会推导出错误的仓库名）。
const ORIGIN_URL = capture("git", ["remote", "get-url", "origin"]) || "";
const GH = ORIGIN_URL.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
if (!GH) {
	log.err(
		`无法从 origin 推导 GitHub 仓库：${ORIGIN_URL || "（本地未配置 origin）"}\n` +
			`    本脚本要求 origin 指向 GitHub，请先执行：\n` +
			`      git remote add origin git@github.com:shawndotty/<仓库名>.git\n` +
			`    （GitHub 仓库名即插件目录名，不要使用 manifest.json 的 id）`
	);
	process.exit(1);
}
const GITHUB_REPO = `${GH[1]}/${GH[2]}`;
const GITEE_REPO = GH[2];
const GITEE_REMOTE_URL = `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}.git`;
const ZIP_NAME = `${GITEE_REPO}.zip`;
const UPLOAD_FILES = [...ASSETS, ZIP_NAME];
const PLUGIN_NAME = GITEE_REPO;

let DRY = false;

function parseArgs(argv) {
	const opts = {
		dryRun: false,
		github: true,
		gitee: true,
		force: false,
		notes: null,
		notesFile: null,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--dry-run") opts.dryRun = true;
		else if (a === "--github-only") opts.gitee = false;
		else if (a === "--gitee-only") opts.github = false;
		else if (a === "--force") opts.force = true;
		else if (a === "--notes") opts.notes = argv[++i];
		else if (a === "--notes-file") opts.notesFile = argv[++i];
		else if (a.startsWith("--notes=")) opts.notes = a.slice("--notes=".length);
		else if (a.startsWith("--notes-file=")) opts.notesFile = a.slice("--notes-file=".length);
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new Error(`未知参数: ${a}（可用 --help 查看用法）`);
	}
	return opts;
}

/** 执行命令并捕获 stdout，失败时返回 null（allowFail）或抛错。 */
function capture(cmd, args) {
	try {
		return execFileSync(cmd, args, {
			cwd: ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

/** 执行命令。readOnly=true 的命令在 dry-run 下也会真实执行（用于读取状态）。 */
function run(cmd, args, { allowFail = false, readOnly = false } = {}) {
	const printable = `${cmd} ${args.join(" ")}`;
	if (DRY && !readOnly) {
		log.cmd(`${printable}   ${c.dim}(dry-run 跳过)${c.reset}`);
		return true;
	}
	log.cmd(printable);
	const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
	if (r.status !== 0) {
		if (allowFail) return false;
		throw new Error(`命令失败: ${printable}`);
	}
	return true;
}

/**
 * 只推送本次发版的 tag（绝不使用 --tags，避免把历史 tag 一起纳入推送）。
 * 不加 --force 且远端已存在「同名但指向不同对象」的 tag 时，git 会拒绝并给出可读提示。
 */
function pushTag(remote, tag, { force = false } = {}) {
	try {
		run("git", ["push", ...(force ? ["--force"] : []), remote, tag]);
	} catch (err) {
		if (force) throw err;
		throw new Error(
			`推送 tag ${tag} 到 ${remote} 失败：远端可能已存在同名 tag 且指向不同对象。` +
				`确认要覆盖请加 --force 重跑。`
		);
	}
}

function loadGiteeToken() {
	if (process.env.GITEE_TOKEN && process.env.GITEE_TOKEN.trim()) {
		return process.env.GITEE_TOKEN.trim();
	}
	const tokenFile = path.join(ROOT, ".gitee-token");
	if (existsSync(tokenFile)) {
		return readFileSync(tokenFile, "utf8").trim();
	}
	return null;
}

function currentBranch() {
	return capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]) || "master";
}

function ensureGiteeRemote() {
	const remotes = (capture("git", ["remote"]) || "").split("\n");
	if (!remotes.includes(GITEE_REMOTE)) {
		log.info(`本地无 ${GITEE_REMOTE} remote，新增：${GITEE_REMOTE_URL}`);
		run("git", ["remote", "add", GITEE_REMOTE, GITEE_REMOTE_URL]);
	}
}

function buildReleaseNotes(opts, version) {
	if (opts.notesFile) {
		const p = path.resolve(opts.notesFile);
		if (!existsSync(p)) throw new Error(`--notes-file 指定的文件不存在: ${p}`);
		return readFileSync(p, "utf8").trim();
	}
	if (opts.notes) return opts.notes.trim();

	const lastTag = capture("git", ["describe", "--tags", "--abbrev=0"]);
	const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
	const notes = capture("git", ["log", range, "--pretty=format:- %s", "--no-merges"]);
	return (notes && notes.trim()) || `Release ${version}`;
}

async function giteeFindReleaseByTag(token, tag) {
	const res = await fetch(
		`${GITEE_API}/repos/${GITEE_OWNER}/${GITEE_REPO}/releases?access_token=${encodeURIComponent(token)}&per_page=100`
	);
	if (!res.ok) return null;
	const list = await res.json();
	if (!Array.isArray(list)) return null;
	return list.find((r) => r.tag_name === tag) || null;
}

async function giteeDeleteRelease(token, id) {
	const form = new URLSearchParams({ access_token: token });
	const res = await fetch(`${GITEE_API}/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${id}`, {
		method: "DELETE",
		body: form,
	});
	if (!res.ok) {
		throw new Error(`Gitee 删除旧 Release 失败 (${res.status}): ${await res.text()}`);
	}
}

async function giteeCreateRelease(token, { tag, version, notes, commitish }) {
	const form = new URLSearchParams();
	form.set("access_token", token);
	form.set("tag_name", tag);
	form.set("name", version);
	form.set("body", notes);
	form.set("target_commitish", commitish);
	form.set("prerelease", "false");

	const res = await fetch(`${GITEE_API}/repos/${GITEE_OWNER}/${GITEE_REPO}/releases`, {
		method: "POST",
		body: form,
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`Gitee 创建 Release 失败 (${res.status}): ${text}`);
	return JSON.parse(text);
}

async function giteeUploadAsset(token, releaseId, fileName) {
	const buf = readFileSync(path.join(ROOT, fileName));
	const form = new FormData();
	form.set("access_token", token);
	form.append("file", new Blob([buf]), fileName);

	const res = await fetch(
		`${GITEE_API}/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files`,
		{ method: "POST", body: form }
	);
	const text = await res.text();
	if (!res.ok) throw new Error(`Gitee 上传附件 ${fileName} 失败 (${res.status}): ${text}`);
	return JSON.parse(text);
}

function printHelp() {
	console.log(`${PLUGIN_NAME} 一键发版（GitHub + Gitee）

用法:
  npm run build:deploy [-- 选项]

选项:
  --dry-run              只预览将执行的命令，不产生任何副作用
  --github-only          只发布到 GitHub
  --gitee-only           只发布到 Gitee
  --notes "<文本>"       手动指定 Release Note
  --notes-file <路径>    从文件读取 Release Note
  --force                tag / Release 已存在时删除并重建
  -h, --help             显示本帮助

授权:
  GitHub 复用已登录的 gh；Gitee 需环境变量 GITEE_TOKEN 或本地 .gitee-token 文件。
`);
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printHelp();
		return;
	}
	DRY = opts.dryRun;

	// 0. 解析并校验版本号
	log.step("解析版本号");
	const manifest = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
	const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
	if (manifest.version !== pkg.version) {
		throw new Error(
			`版本号不一致：manifest.json=${manifest.version}，package.json=${pkg.version}。` +
				`请先执行 npm version <版本>（触发 version-bump.mjs）并提交后再发版。`
		);
	}
	const version = manifest.version;
	const tag = `v${version}`;
	log.ok(`版本 ${version} → tag ${tag}`);
	if (DRY) log.warn("dry-run 模式：仅预览，不产生任何副作用");

	// 1. 前置校验
	log.step("前置校验");
	const dirty = capture("git", ["status", "--porcelain"]);
	if (dirty) {
		throw new Error(`工作区不干净，请先手动提交版本号变更后再发版：\n${dirty}`);
	}
	log.ok("工作区干净");

	run("git", ["fetch", "--tags", "--quiet", "origin"], { readOnly: true, allowFail: true });

	const localTag = capture("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
	if (localTag) {
		if (!opts.force) throw new Error(`本地已存在 tag ${tag}，如需覆盖请加 --force`);
		log.warn(`本地已存在 tag ${tag}，--force 将删除并重建`);
		run("git", ["tag", "-d", tag]);
	}

	if (opts.github) {
		const existing = capture("gh", ["release", "view", tag, "--repo", GITHUB_REPO]);
		if (existing) {
			if (!opts.force) throw new Error(`GitHub 已存在 Release ${tag}，如需覆盖请加 --force`);
			log.warn(`GitHub 已存在 Release ${tag}，--force 将删除并重建`);
			run("gh", ["release", "delete", tag, "--repo", GITHUB_REPO, "--yes"]);
		}
	}

	const branch = currentBranch();
	log.ok(`当前分支 ${branch}`);

	const giteeToken = opts.gitee ? loadGiteeToken() : null;
	if (opts.gitee && !giteeToken) {
		log.warn(
			"未检测到 Gitee 令牌：请设置环境变量 GITEE_TOKEN，或在插件目录创建 .gitee-token（内容为裸 token）。" +
				"GitHub 发布仍会继续，Gitee 步骤将报错退出；如只想发 GitHub 请加 --github-only。"
		);
	}

	// 2. 构建
	log.step("构建");
	run(NPM, ["run", "build"]);

	// 3. 打包
	log.step("打包");
	for (const f of ASSETS) {
		if (!DRY && !existsSync(path.join(ROOT, f))) {
			throw new Error(`构建产物缺失: ${f}`);
		}
	}
	if (!DRY) {
		const zipPath = path.join(ROOT, ZIP_NAME);
		if (existsSync(zipPath)) rmSync(zipPath);
	}
	run("zip", ["-j", ZIP_NAME, ...ASSETS]);
	log.ok(`已生成 ${ZIP_NAME}`);

	// 4. Release Note
	log.step("生成 Release Note");
	const notes = buildReleaseNotes(opts, version);
	log.info(notes.split("\n").slice(0, 5).join("\n  ") + (notes.split("\n").length > 5 ? "\n  ..." : ""));

	const notesFile = path.join(os.tmpdir(), `${PLUGIN_NAME}-notes-${version}.md`);
	if (!DRY) writeFileSync(notesFile, `${notes}\n`);

	// 5. 打 tag 并推送
	log.step("创建并推送 tag");
	run("git", ["tag", "-a", tag, "-m", `Release ${version}`]);

	if (opts.github) {
		run("git", ["push", "origin", branch]);
		pushTag("origin", tag, { force: opts.force });
		log.ok(`已推送 ${tag} 到 origin`);
	}

	if (opts.gitee && giteeToken) {
		ensureGiteeRemote();
		run("git", ["push", GITEE_REMOTE, branch]);
		pushTag(GITEE_REMOTE, tag, { force: opts.force });
		log.ok(`已推送 ${branch} 与 ${tag} 到 ${GITEE_REMOTE}`);
	}

	// 6. GitHub Release
	if (opts.github) {
		log.step("发布到 GitHub");
		run("gh", [
			"release",
			"create",
			tag,
			"--repo",
			GITHUB_REPO,
			"--title",
			version,
			"--notes-file",
			notesFile,
			"--verify-tag",
			...UPLOAD_FILES,
		]);
		log.ok(`https://github.com/${GITHUB_REPO}/releases/tag/${tag}`);
	}

	// 7. Gitee Release
	if (opts.gitee) {
		log.step("发布到 Gitee");
		if (DRY) {
			if (!giteeToken) log.warn("未配置 Gitee 令牌（dry-run 仅预览，正式发布时必需）");
			log.cmd(
				`POST ${GITEE_API}/repos/${GITEE_OWNER}/${GITEE_REPO}/releases  (tag_name=${tag})   ${c.dim}(dry-run 跳过)${c.reset}`
			);
			for (const f of UPLOAD_FILES) {
				log.cmd(
					`POST .../releases/{id}/attach_files  (file=${f})   ${c.dim}(dry-run 跳过)${c.reset}`
				);
			}
		} else {
			if (!giteeToken) {
				throw new Error(
					"缺少 Gitee 令牌，无法发布到 Gitee。请设置环境变量 GITEE_TOKEN，或在插件目录创建 .gitee-token（内容为裸 token）。" +
						"（GitHub 部分已完成，可加 --github-only 跳过 Gitee 重跑。）"
				);
			}
			const commitish = capture("git", ["rev-list", "-n", "1", tag]) || "master";
			const existing = await giteeFindReleaseByTag(giteeToken, tag);
			if (existing) {
				if (!opts.force) {
					throw new Error(`Gitee 已存在 Release ${tag}，如需覆盖请加 --force`);
				}
				log.warn(`Gitee 已存在 Release ${tag}，--force 删除中`);
				await giteeDeleteRelease(giteeToken, existing.id);
			}

			const release = await giteeCreateRelease(giteeToken, { tag, version, notes, commitish });
			log.ok(`已创建 Gitee Release（id=${release.id}）`);
			for (const f of UPLOAD_FILES) {
				await giteeUploadAsset(giteeToken, release.id, f);
				log.ok(`已上传 ${f}`);
			}
			log.ok(`https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/tag/${tag}`);
		}
	}

	// 8. 汇总
	log.step(DRY ? "dry-run 完成（未产生任何副作用）" : "发版完成");
	if (!DRY) {
		if (opts.github) log.info(`GitHub: https://github.com/${GITHUB_REPO}/releases/tag/${tag}`);
		if (opts.gitee) log.info(`Gitee : https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/tag/${tag}`);
	}
}

main().catch((err) => {
	log.err(err.message || String(err));
	process.exit(1);
});
