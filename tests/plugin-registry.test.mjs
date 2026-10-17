/**
 * `src/services/plugin-registry.ts` —— 插件注册表与 SSG 白名单。
 *
 * 注册表是「命令面板」与「设置页 Plugins Center」共用的唯一数据源，
 * 任何一条 URL 写错都会让一键安装静默失败，所以这里对结构做整体校验。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import en from '../src/lang/locale/en.ts';
import {
	IOTO_PLUGINS,
	SSG_VIEW_ID_WHITELIST,
	isSSGViewIDAllowed,
} from '../src/services/plugin-registry.ts';

test('注册表 key 唯一', () => {
	const keys = IOTO_PLUGINS.map((entry) => entry.key);
	assert.equal(new Set(keys).size, keys.length);
});

test('每条注册项的 i18n key 都能在英文词典里找到', () => {
	const dictionary = new Set(Object.keys(en));
	for (const entry of IOTO_PLUGINS) {
		assert.ok(dictionary.has(entry.nameKey), `缺少 nameKey: ${entry.nameKey}`);
		assert.ok(dictionary.has(entry.descKey), `缺少 descKey: ${entry.descKey}`);
	}
});

test('每条注册项的 GitHub / Gitee 仓库地址与 key 对应', () => {
	for (const entry of IOTO_PLUGINS) {
		assert.match(
			entry.githubUrl,
			new RegExp(`^https://github\\.com/[^/]+/${entry.key}$`),
			`GitHub 地址异常: ${entry.key}`,
		);
		assert.match(
			entry.giteeUrl,
			new RegExp(`^https://gitee\\.com/[^/]+/${entry.key}$`),
			`Gitee 地址异常: ${entry.key}`,
		);
	}
});

test('只有同步脚本生成器需要 viewID 白名单鉴权', () => {
	const gated = IOTO_PLUGINS.filter((entry) => entry.requireViewID);
	assert.deepEqual(
		gated.map((entry) => entry.key),
		['sync-script-generator'],
	);
});

test('isSSGViewIDAllowed 只认白名单内的 viewID', () => {
	for (const viewID of SSG_VIEW_ID_WHITELIST) {
		assert.equal(isSSGViewIDAllowed(viewID), true, viewID);
	}
	assert.equal(isSSGViewIDAllowed('viwNotWhitelisted'), false);
	assert.equal(isSSGViewIDAllowed(''), false);
	assert.equal(isSSGViewIDAllowed(undefined), false);
});
