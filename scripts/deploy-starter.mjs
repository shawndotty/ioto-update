#!/usr/bin/env node
/**
 * 把 IOTO Update 插件的运行时文件复制到同级的 IOTO-Starter 库
 *
 * 用法（在 ioto-update 插件目录下执行）：
 *   npm run deploy:starter
 *
 * 复制的文件：main.js / manifest.json / styles.css
 * 目标目录：<IOTO-Plugins 同级>/IOTO-Starter/.obsidian/plugins/ioto-update
 *
 * 约定：
 *   - 只覆盖上述三个运行时文件，目标目录里的其他文件（如 data.json）保持不动。
 *   - 复制前请先执行 `npm run build`，否则复制的是上一版构建产物。
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本脚本位于 <插件目录>/scripts/，上一级即插件目录
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ASSETS = ["main.js", "manifest.json", "styles.css"];
const TARGET_VAULT = "IOTO-Starter";
const PLUGIN_ID = "ioto-update";

// 插件目录 = 库/.obsidian/plugins/ioto-update，向上三级即库根目录
const VAULT = path.resolve(ROOT, "..", "..", "..");
const TARGET = path.resolve(VAULT, "..", TARGET_VAULT, ".obsidian", "plugins", PLUGIN_ID);

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
};

const size = (file) => `${(statSync(file).size / 1024).toFixed(1)} KB`;

log.step(`复制 IOTO Update → ${TARGET_VAULT}`);

for (const file of ASSETS) {
	if (!existsSync(path.join(ROOT, file))) {
		log.err(`源文件不存在：${path.join(ROOT, file)}`);
		log.info(`请先执行 ${c.bold}npm run build${c.reset} 生成构建产物`);
		process.exit(1);
	}
}

mkdirSync(TARGET, { recursive: true });

for (const file of ASSETS) {
	const src = path.join(ROOT, file);
	copyFileSync(src, path.join(TARGET, file));
	log.ok(`${file} ${c.dim}(${size(src)})${c.reset}`);
}

log.info(`目标目录 ${c.dim}${TARGET}${c.reset}`);
console.log(`\n${c.green}${c.bold}完成${c.reset} 已复制 ${ASSETS.length} 个文件到 ${TARGET_VAULT}\n`);
