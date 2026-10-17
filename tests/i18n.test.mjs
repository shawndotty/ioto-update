/**
 * `src/lang/` —— 词典对齐与 key 覆盖。
 *
 * 三类真实事故都在这里拦：
 * 1. 某个语言漏翻 / 多写 key（`t()` 会静默回落英文）；
 * 2. 源码里写了 `t("...")` 但词典里没有（界面直接显示英文原文甚至 undefined）；
 * 3. 词典值为空串（界面出现空白项）。
 *
 * 与 `ioto-tasks-center/tests/locale-key-alignment.test.mjs` 同一口径：
 * `en` 是基准，其余语言必须与之**完全一致**。
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { moment } from './stubs/obsidian.mjs';
import en from '../src/lang/locale/en.ts';
import zhCN from '../src/lang/locale/zh-cn.ts';
import zhTW from '../src/lang/locale/zh-tw.ts';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const LOCALE_DIR = path.join(SRC_DIR, 'lang/locale');
const REFERENCE = 'en';
const locales = { en, 'zh-cn': zhCN, 'zh-tw': zhTW };

test('语言目录里发现的词典与 helpers 登记的一致', () => {
	const names = readdirSync(LOCALE_DIR)
		.filter((name) => name.endsWith('.ts') && !name.startsWith('index'))
		.map((name) => name.replace(/\.ts$/, ''))
		.sort();
	assert.deepEqual(names, ['en', 'zh-cn', 'zh-tw']);
});

test('各语言词典的 key 与 en 完全一致', () => {
	const referenceKeys = Object.keys(locales[REFERENCE]).sort();
	for (const [name, dictionary] of Object.entries(locales)) {
		if (name === REFERENCE) continue;
		assert.deepEqual(
			Object.keys(dictionary).sort(),
			referenceKeys,
			`${name} 的 key 与 ${REFERENCE} 不一致`,
		);
	}
});

test('词典值都是非空字符串', () => {
	for (const [name, dictionary] of Object.entries(locales)) {
		for (const [key, value] of Object.entries(dictionary)) {
			assert.equal(typeof value, 'string', `${name}.${key} 不是字符串`);
			assert.ok(value.trim().length > 0, `${name}.${key} 是空值`);
		}
	}
});

/** 收集源码里 `t("字面量")` 的 key（跳过注释行与 lang 目录）。 */
function collectUsedKeys(dir, keys = new Map()) {
	for (const name of readdirSync(dir)) {
		const filePath = path.join(dir, name);
		if (statSync(filePath).isDirectory()) {
			if (filePath === path.join(SRC_DIR, 'lang')) continue;
			collectUsedKeys(filePath, keys);
			continue;
		}
		if (!filePath.endsWith('.ts')) continue;

		const source = readFileSync(filePath, 'utf8');
		for (const line of source.split('\n')) {
			if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
			const regex = /\bt\(\s*(["'])((?:(?!\1).)+)\1/gs;
			for (const match of line.matchAll(regex)) {
				if (!keys.has(match[2])) keys.set(match[2], filePath);
			}
		}
	}
	return keys;
}

test('源码里出现的每个 t("...") key 都在词典里', () => {
	const used = collectUsedKeys(SRC_DIR);
	assert.ok(used.size > 100, `扫描到的 key 过少: ${used.size}`);

	const dictionary = new Set(Object.keys(en));
	const missing = [...used].filter(([key]) => !dictionary.has(key));
	assert.deepEqual(
		missing.map(([key, file]) => `${key} (${path.relative(SRC_DIR, file)})`),
		[],
	);
});

test('t() 默认按英文词典输出', async () => {
	const original = moment.locale();
	moment.locale('en');
	try {
		const { t } = await import('../src/lang/helpers.ts');
		assert.equal(t('Update Core Files'), 'Update Core Files');
		assert.equal(t('IOTO Framework Path'), en['IOTO Framework Path']);
	} finally {
		moment.locale(original);
	}
});
