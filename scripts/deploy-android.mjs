#!/usr/bin/env node
/**
 * 把生产构建产物部署到 Android 手机上的 Obsidian 库（通过 adb）。
 *
 * Usage:
 *   npm run build:android            # 构建 + 部署
 *   node scripts/deploy-android.mjs
 *   node scripts/deploy-android.mjs --vault IOTO --device <serial>
 *   node scripts/deploy-android.mjs --no-reload
 *
 * 约定：
 *   - 只覆盖 main.js / manifest.json / styles.css，不碰目标库的 data.json。
 *   - 源文件 SHA-256 与手机端一致时跳过（--force 强制覆盖）。
 *   - 部署后通过 WebView CDP（adb forward）重载插件并核对版本号；
 *     手机锁屏时 CDP 连不上，会用 --no-reload 的降级提示结束。
 *
 * 依赖：adb 在 PATH 中；Node ≥ 22（用到全局 fetch / WebSocket）。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['main.js', 'manifest.json', 'styles.css'];
const DEFAULT_VAULT = 'EvanIOTO';
const DEVICE_VAULT_ROOT = '/sdcard/Documents';
const STAGING = '/data/local/tmp/ioto-deploy';
const APP_ID = 'md.obsidian';
const CDP_HOST_PORT = 9333;

const c = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	bold: '\x1b[1m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
};

const log = {
	step: (message) => console.log(`\n${c.cyan}${c.bold}▶ ${message}${c.reset}`),
	info: (message) => console.log(`  ${message}`),
	ok: (message) => console.log(`  ${c.green}✓${c.reset} ${message}`),
	warn: (message) => console.log(`  ${c.yellow}!${c.reset} ${message}`),
	err: (message) => console.error(`  ${c.red}✗${c.reset} ${message}`),
};

function parseArgs(argv) {
	const opts = { vault: DEFAULT_VAULT, device: null, reload: true, force: false, build: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const takeValue = () => {
			const value = argv[++i];
			if (!value || value.startsWith('--')) throw new Error(`${arg} 后需要提供参数值`);
			return value;
		};
		if (arg === '--vault') opts.vault = takeValue();
		else if (arg.startsWith('--vault=')) opts.vault = arg.slice('--vault='.length);
		else if (arg === '--device') opts.device = takeValue();
		else if (arg.startsWith('--device=')) opts.device = arg.slice('--device='.length);
		else if (arg === '--no-reload') opts.reload = false;
		else if (arg === '--force') opts.force = true;
		else if (arg === '--build') opts.build = true;
		else if (arg === '--help' || arg === '-h') opts.help = true;
		else throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
	}
	if (!opts.vault) throw new Error('--vault 不能为空');
	return opts;
}

function printHelp() {
	console.log(`部署构建产物到 Android 手机上的 Obsidian 库

用法:
  npm run build:android
  node scripts/deploy-android.mjs [选项]

选项:
  --vault <名称|路径>  手机上的库名（默认：${DEFAULT_VAULT} → ${DEVICE_VAULT_ROOT}/${DEFAULT_VAULT}）
                       也可以直接给设备上的绝对路径，如 /sdcard/Documents/IOTO
  --device <serial>    adb 设备序列号（默认：唯一在线设备）
  --no-reload          只推文件，不通过 CDP 重载插件
  --force              内容相同时也强制覆盖
  --build              部署前先执行 npm run build
  -h, --help           显示此帮助
`);
}

function formatKb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

function run(command, args, options = {}) {
	return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function adb(args, options) {
	return run('adb', args, options);
}

function adbShell(command) {
	return adb(['shell', command]);
}

function resolveDeviceVault(vault) {
	if (vault.startsWith('/')) return vault;
	return `${DEVICE_VAULT_ROOT}/${vault}`;
}

function pickDevice(requested) {
	let output;
	try {
		output = adb(['devices']);
	} catch {
		throw new Error('adb 不可用：请确认已安装 Android Platform Tools 且 adb 在 PATH 中');
	}
	const devices = output
		.split('\n')
		.slice(1)
		.map((line) => line.trim().split(/\s+/))
		.filter((parts) => parts[0] && parts[1] === 'device')
		.map((parts) => parts[0]);
	if (requested) {
		if (!devices.includes(requested)) {
			throw new Error(`找不到在线设备 ${requested}（当前在线：${devices.join(', ') || '无'}）`);
		}
		return requested;
	}
	if (devices.length === 0) throw new Error('没有已连接的设备：请用 USB 连接手机并开启 USB 调试');
	if (devices.length > 1) {
		throw new Error(`检测到多台设备，请用 --device 指定：${devices.join(', ')}`);
	}
	return devices[0];
}

function remoteSha(serial, remotePath) {
	try {
		const output = adb(['-s', serial, 'shell', `sha256sum '${remotePath}' 2>/dev/null`]);
		const match = output.trim().match(/^([0-9a-f]{64})/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

function assertBuildFresh() {
	const newestSource = readdirSync(path.join(ROOT, 'src'), { recursive: true })
		.map((entry) => path.join(ROOT, 'src', entry))
		.filter((entry) => existsSync(entry) && statSync(entry).isFile())
		.reduce((newest, entry) => Math.max(newest, statSync(entry).mtimeMs), 0);
	const built = statSync(path.join(ROOT, 'main.js')).mtimeMs;
	if (newestSource > built) {
		log.warn('src/ 比 main.js 新，构建产物可能已过期（加 --build 或在部署前跑 npm run build）');
	}
}

async function fetchJson(url, timeoutMs = 3000) {
	const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	return response.json();
}

async function cdpEvaluate(wsUrl, expression) {
	const socket = new WebSocket(wsUrl);
	const openTimeout = setTimeout(() => socket.close(), 5000);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = () => reject(new Error('无法建立 CDP WebSocket 连接'));
	});
	clearTimeout(openTimeout);
	try {
		let id = 0;
		const pending = new Map();
		socket.onmessage = (event) => {
			const message = JSON.parse(event.data);
			if (pending.has(message.id)) {
				pending.get(message.id)(message);
				pending.delete(message.id);
			}
		};
		const send = (method, params = {}) =>
			new Promise((resolve, reject) => {
				const messageId = ++id;
				pending.set(messageId, resolve);
				socket.send(JSON.stringify({ id: messageId, method, params }));
				setTimeout(() => {
					if (pending.has(messageId)) {
						pending.delete(messageId);
						reject(new Error(`CDP 调用超时: ${method}`));
					}
				}, 10000);
			});
		await send('Runtime.enable');
		const result = await send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.result?.exceptionDetails) {
			throw new Error(`页面内执行出错: ${result.result.exceptionDetails.text}`);
		}
		return result.result?.result?.value;
	} finally {
		socket.close();
	}
}

async function connectCdp(serial) {
	const pid = adb(['-s', serial, 'shell', `pidof ${APP_ID}`]).trim().split(/\s+/)[0];
	if (!pid) throw new Error('手机上 Obsidian 未在运行');

	adb(['-s', serial, 'forward', `tcp:${CDP_HOST_PORT}`, `localabstract:webview_devtools_remote_${pid}`]);

	const listUrl = `http://127.0.0.1:${CDP_HOST_PORT}/json/list`;
	const deadline = Date.now() + 15000;
	let lastError = null;
	while (Date.now() < deadline) {
		try {
			const pages = await fetchJson(listUrl, 2000);
			const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
			if (page) return page.webSocketDebuggerUrl;
			lastError = new Error('CDP 里没有可用的 page');
		} catch (error) {
			lastError = error;
		}
		// 手机锁屏/应用被暂停时 CDP 会拒绝连接，拉起活动页面是唯一无需解锁的补救
		try {
			adb(['-s', serial, 'shell', `am start -n ${APP_ID}/.MainActivity`]);
		} catch {
			/* 忽略：下一轮重试会给出最终结论 */
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`连不上 WebView CDP（请解锁手机屏幕后重试）：${lastError?.message ?? '未知原因'}`);
}

async function reloadPlugin(serial, pluginId, expectedVersion, vaultName, vaultPath) {
	const wsUrl = await connectCdp(serial);

	const info = await cdpEvaluate(
		wsUrl,
		`(() => {
			const app = window.app;
			return {
				vault: app?.vault?.getName?.() ?? null,
				basePath: app?.vault?.adapter?.getBasePath?.() ?? null,
				version: app?.plugins?.manifests?.[${JSON.stringify(pluginId)}]?.version ?? null,
			};
		})()`
	);
	log.info(`当前活动库：${info?.vault ?? '未知'}（${info?.basePath ?? '未知路径'}）`);
	log.info(`重载前插件版本：${info?.version ?? '未安装'}`);

	if (info?.vault && info.vault !== vaultName) {
		log.warn(`手机上当前活动库是 ${info.vault}，不是 ${vaultName}；已跳过重载`);
		return { reloaded: false, version: info.version };
	}

	const result = await cdpEvaluate(
		wsUrl,
		`(async () => {
			const app = window.app;
			const id = ${JSON.stringify(pluginId)};
			const before = app.plugins.manifests?.[id]?.version ?? null;
			try {
				await app.plugins.disablePlugin(id);
				await app.plugins.loadManifests();
				await app.plugins.enablePlugin(id);
			} catch (error) {
				return { ok: false, error: String(error), before };
			}
			return {
				ok: true,
				before,
				manifest: app.plugins.manifests?.[id]?.version ?? null,
				live: app.plugins.plugins?.[id]?.manifest?.version ?? null,
				basePath: app.vault.adapter.getBasePath?.() ?? null,
			};
		})()`
	);

	if (!result?.ok) throw new Error(`重载失败：${result?.error ?? '未知错误'}`);

	const version = result.manifest ?? result.live ?? null;
	if (version !== expectedVersion) {
		throw new Error(`重载后版本仍为 ${version}，期望 ${expectedVersion}（可重开 Obsidian 再看）`);
	}
	log.ok(`插件已重载：${result.before ?? '未安装'} → ${version}`);
	return { reloaded: true, version };
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printHelp();
		return;
	}

	if (opts.build) {
		log.step('构建');
		run('npm', ['run', 'build'], { stdio: 'inherit', cwd: ROOT });
		log.ok('构建完成');
	}

	log.step('解析目标');
	const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
	const pluginId = manifest.id;
	const vaultPath = resolveDeviceVault(opts.vault);
	const targetDir = `${vaultPath}/.obsidian/plugins/${pluginId}`;

	log.step('校验构建产物');
	for (const asset of ASSETS) {
		if (!existsSync(path.join(ROOT, asset))) {
			throw new Error(`构建产物缺失: ${asset}（请先运行 npm run build）`);
		}
	}
	assertBuildFresh();
	log.ok(`插件 ${pluginId} v${manifest.version}，${ASSETS.length} 个产物齐全`);
	log.info(`→ ${targetDir}`);

	const serial = pickDevice(opts.device);
	log.ok(`设备 ${serial}`);

	try {
		adbShell(`test -d '${vaultPath}/.obsidian'`);
	} catch {
		throw new Error(`设备上 ${vaultPath} 不像 Obsidian 库（缺少 .obsidian 目录），请用 --vault 指定`);
	}

	log.step('推送文件');
	adbShell(`rm -rf '${STAGING}' && mkdir -p '${STAGING}'`);
	adbShell(`mkdir -p '${targetDir}'`);

	let changed = 0;
	for (const asset of ASSETS) {
		const localPath = path.join(ROOT, asset);
		const localHash = sha256(readFileSync(localPath));
		const remotePath = `${targetDir}/${asset}`;
		const remoteHash = remoteSha(serial, remotePath);
		const size = formatKb(statSync(localPath).size);

		if (!opts.force && remoteHash === localHash) {
			log.info(`${asset} ${c.dim}未变化（${size}）${c.reset}`);
			continue;
		}

		adb(['-s', serial, 'push', localPath, `${STAGING}/${asset}`]);
		adbShell(`cp -f '${STAGING}/${asset}' '${remotePath}' && sync`);
		const writtenHash = remoteSha(serial, remotePath);
		if (writtenHash !== localHash) {
			throw new Error(`${asset} 校验失败：本地 ${localHash.slice(0, 12)}… / 手机 ${writtenHash?.slice(0, 12) ?? '读取失败'}…`);
		}
		changed++;
		const arrow = remoteHash ? `${c.dim}(${remoteHash.slice(0, 8)}… → ${localHash.slice(0, 8)}…)${c.reset}` : `${c.dim}（新增 ${size}）${c.reset}`;
		log.ok(`${asset} ${arrow}`);
	}
	adbShell(`rm -rf '${STAGING}'`);

	if (changed === 0) {
		log.ok('手机端已是最新，无需覆盖');
	} else {
		log.ok(`已更新 ${changed} 个文件（data.json 未触碰）`);
	}

	if (!opts.reload) {
		log.step('完成');
		log.warn('已跳过重载（--no-reload）：请在手机上手动重载插件或重开 Obsidian');
		return;
	}

	log.step('通过 CDP 重载插件');
	try {
		const result = await reloadPlugin(serial, pluginId, manifest.version, path.basename(vaultPath), vaultPath);
		if (!result.reloaded) {
			log.warn('文件已就位，但未重载：请切换到该库后重跑，或在设置里禁用/启用一次插件');
		}
	} catch (error) {
		log.warn(error instanceof Error ? error.message : String(error));
		log.info('文件已推送完成；解锁手机并让 Obsidian 保持前台后可重跑本脚本，或在手机上重开 Obsidian 让新版本生效');
		process.exitCode = 1;
		return;
	}

	log.step('完成');
	log.ok(`${pluginId} v${manifest.version} 已在手机上生效`);
}

try {
	await main();
} catch (error) {
	log.err(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
