/**
 * 单测用的 TypeScript 加载器（`node --test --import ./tests/ts-loader.mjs`）。
 *
 * 与 `ioto-tasks-center` / `text-popup` 的差别：那两个项目用 jiti 加载 `.ts`，
 * 本项目的 `node_modules` 属主是 root（历史 `sudo npm install` 遗留），
 * 无法再安装 jiti。这里改用**已经是本项目 devDependency 的 esbuild** 做同等的事：
 * - `resolve`：把 `obsidian` 指向 `tests/stubs/obsidian.mjs`；把源码里无扩展名的
 *   相对导入补成 `.ts` / `/index.ts`；
 * - `load`：用 esbuild 以 TS loader 转译，产出 ESM。
 *
 * 只替「TypeScript + Obsidian 模块边界」，不模拟任何 Obsidian 行为。
 */

import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const STUB_URL = pathToFileURL(
	path.join(import.meta.dirname, 'stubs/obsidian.mjs'),
).href;

/** 省略扩展名时依次尝试 `.ts` / `/index.ts`。 */
function resolveTsFile(basePath) {
	for (const candidate of [`${basePath}.ts`, path.join(basePath, 'index.ts')]) {
		if (existsSync(candidate)) return pathToFileURL(candidate).href;
	}
	return null;
}

/** 模块解析兜底：相对导入按父模块目录解析，`src/...` 按 tsconfig 的 baseUrl 解析。 */
function resolveFallback(specifier, parentURL) {
	if (specifier.startsWith('src/')) {
		return resolveTsFile(path.join(PROJECT_ROOT, specifier));
	}
	if (!parentURL || !specifier.startsWith('.')) return null;
	return resolveTsFile(
		path.resolve(path.dirname(fileURLToPath(parentURL)), specifier),
	);
}

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'obsidian') {
			return { url: STUB_URL, shortCircuit: true };
		}
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			const fallback = resolveFallback(specifier, context.parentURL);
			if (fallback) return { url: fallback, shortCircuit: true };
			throw error;
		}
	},

	load(url, context, nextLoad) {
		if (url.endsWith('.ts')) {
			const { code } = transformSync(readFileSync(fileURLToPath(url), 'utf8'), {
				loader: 'ts',
				format: 'esm',
				target: 'node18',
				sourcefile: url,
				sourcemap: 'inline',
			});
			return { format: 'module', source: code, shortCircuit: true };
		}
		return nextLoad(url, context);
	},
});
