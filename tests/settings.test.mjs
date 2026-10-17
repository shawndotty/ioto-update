/**
 * `src/models/settings.ts` + `src/models/default-settings.ts` —— 设置装载与合并顺序。
 *
 * 合并顺序是 `DEFAULT_SETTINGS → ioto-settings 插件里的路径 → 用户已保存的 data.json`，
 * 也就是：别人（ioto-settings）给的是默认值，用户自己存过的优先级最高。
 * 这条顺序一旦被改动，用户升级后会看到路径被「重置」，所以值得钉住。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/models/default-settings.ts';
import { SettingsManager } from '../src/models/settings.ts';

/** 构造一个只有插件注册表的最小 App。 */
function createApp(plugins = {}) {
	return { vault: { configDir: '.obsidian' }, plugins: { plugins } };
}

test('默认设置包含一键部署需要的全部 updateIDs（含 skills）', () => {
	assert.deepEqual(Object.keys(DEFAULT_SETTINGS.updateIDs).sort(), [
		'iotoCore',
		'iotoCssSnippets',
		'iotoHelpDocs',
		'iotoSettingPlugin',
		'iotoSkills',
		'myIotoFull',
	]);
	for (const [key, value] of Object.entries(DEFAULT_SETTINGS.updateIDs)) {
		assert.deepEqual(value, { baseID: '', tableID: '', viewID: '' }, key);
	}
});

test('默认设置的授权与语言字段处于未授权 / 跟随 Obsidian 状态', () => {
	assert.equal(DEFAULT_SETTINGS.updateAPIKey, '');
	assert.equal(DEFAULT_SETTINGS.updateAPIKeyIsValid, false);
	assert.equal(DEFAULT_SETTINGS.userChecked, false);
	assert.equal(DEFAULT_SETTINGS.userEmail, '');
	assert.equal(DEFAULT_SETTINGS.iotoRunningLanguage, 'ob');
});

test('未安装 ioto-settings 时只返回默认设置', async () => {
	const manager = new SettingsManager(
		async () => ({}),
		async () => {},
		createApp(),
	);
	const settings = await manager.load();
	assert.equal(settings.iotoFrameworkPath, DEFAULT_SETTINGS.iotoFrameworkPath);
	assert.equal(
		settings.userSyncScriptsFolder,
		DEFAULT_SETTINGS.userSyncScriptsFolder,
	);
});

test('ioto-settings 的框架路径会作为默认值注入设置', async () => {
	const app = createApp({
		'ioto-settings': { settings: { IOTOFrameworkPath: '0-辅助/IOTO' } },
	});
	const manager = new SettingsManager(async () => ({}), async () => {}, app);
	const settings = await manager.load();

	assert.equal(settings.iotoFrameworkPath, '0-辅助/IOTO');
	assert.equal(
		settings.userSyncScriptsFolder,
		'0-辅助/IOTO/Templates/Templater/MyIOTO',
	);
});

test('用户已保存的 data.json 覆盖默认值与 ioto-settings 的路径', async () => {
	const app = createApp({
		'ioto-settings': { settings: { IOTOFrameworkPath: 'from-plugin' } },
	});
	const manager = new SettingsManager(
		async () => ({
			iotoFrameworkPath: 'from-user',
			userSyncScriptsFolder: 'from-user/templates',
			iotoRunningLanguage: 'zh-tw',
		}),
		async () => {},
		app,
	);
	const settings = await manager.load();

	assert.equal(settings.iotoFrameworkPath, 'from-user');
	assert.equal(settings.userSyncScriptsFolder, 'from-user/templates');
	assert.equal(settings.iotoRunningLanguage, 'zh-tw');
	// 未在 data.json 中出现的字段仍取默认值
	assert.equal(settings.updateAPIKey, DEFAULT_SETTINGS.updateAPIKey);
});

test('update 只合并传入的字段，save 把合并结果整体写回', async () => {
	const saved = [];
	const manager = new SettingsManager(
		async () => ({}),
		async (data) => saved.push(data),
		createApp(),
	);
	await manager.load();

	manager.update({ updateAPIKey: 'pat-key' });
	manager.update({ userEmail: 'user@example.com' });
	await manager.save();

	assert.equal(saved.length, 1);
	assert.equal(saved[0].updateAPIKey, 'pat-key');
	assert.equal(saved[0].userEmail, 'user@example.com');
	assert.equal(saved[0].userChecked, false, '未传入的字段保持原值');
	assert.equal(manager.get(), saved[0], 'get() 返回的就是被保存的那份对象');
});
