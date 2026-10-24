#!/usr/bin/env node
/**
 * 把生产构建产物复制到本地 Obsidian 库。
 *
 * Usage:
 *   npm run build:local
 *   npm run build:local -- --vault <path>
 *   node scripts/deploy-vault.mjs
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['main.js', 'manifest.json', 'styles.css'];
const DEFAULT_VAULT = path.join(os.homedir(), 'Documents', 'IOTO');

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
	const opts = { vault: null, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--vault') {
			const vault = argv[++i];
			if (!vault || vault.startsWith('--')) {
				throw new Error('--vault 后需要提供库根目录路径');
			}
			opts.vault = vault;
		} else if (arg.startsWith('--vault=')) {
			opts.vault = arg.slice('--vault='.length);
			if (!opts.vault) throw new Error('--vault 后需要提供库根目录路径');
		} else if (arg === '--help' || arg === '-h') {
			opts.help = true;
		} else {
			throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
		}
	}
	return opts;
}

function printHelp() {
	console.log(`部署构建产物到本地 Obsidian 库

用法:
  npm run build:local
  npm run build:local -- --vault <路径>
  node scripts/deploy-vault.mjs [选项]

选项:
  --vault <路径>  Obsidian 库根目录（默认：${DEFAULT_VAULT}）
  -h, --help      显示此帮助
`);
}

function resolveVaultPath(vaultPath) {
	const expanded = vaultPath.startsWith('~')
		? path.join(os.homedir(), vaultPath.slice(1))
		: vaultPath;
	return path.resolve(expanded);
}

function formatKb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printHelp();
		return;
	}

	log.step('解析目标库');
	const vault = resolveVaultPath(opts.vault || DEFAULT_VAULT);
	if (!existsSync(path.join(vault, '.obsidian'))) {
		throw new Error(
			`目标路径不像是 Obsidian 库（缺少 .obsidian 目录）：${vault}\n` +
				`请使用 --vault <库根目录> 指定目标库，或检查默认路径 ${DEFAULT_VAULT}`
		);
	}

	const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
	const targetDir = path.join(vault, '.obsidian', 'plugins', manifest.id);
	log.ok(`插件 ${manifest.id} v${manifest.version}`);
	log.info(`→ ${targetDir}`);

	log.step('校验构建产物');
	for (const asset of ASSETS) {
		if (!existsSync(path.join(ROOT, asset))) {
			throw new Error(`构建产物缺失: ${asset}（请先运行 npm run build）`);
		}
	}
	log.ok(`${ASSETS.length} 个产物齐全`);

	log.step('复制到库');
	if (!existsSync(targetDir)) {
		mkdirSync(targetDir, { recursive: true });
		log.warn(`目标目录不存在，已创建: ${targetDir}`);
	}
	for (const asset of ASSETS) {
		const source = path.join(ROOT, asset);
		const destination = path.join(targetDir, asset);
		if (source === destination) {
			log.warn(`${asset} 源与目标为同一文件，已跳过`);
			continue;
		}
		const previous = existsSync(destination) ? statSync(destination) : null;
		copyFileSync(source, destination);
		const copied = statSync(destination);
		const size =
			previous && previous.size !== copied.size
				? `${c.dim}(${formatKb(previous.size)} → ${formatKb(copied.size)})${c.reset}`
				: `${c.dim}(${formatKb(copied.size)})${c.reset}`;
		log.ok(`${asset} ${size}`);
	}

	log.step('完成');
	log.info('若 Obsidian 已打开该库，请重载插件或重新加载应用后再测试。');
}

try {
	main();
} catch (error) {
	log.err(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
