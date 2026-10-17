/**
 * `src/services/plugin-service.ts` + `templater-service.ts` —— 插件启停与设置代理。
 *
 * 一键部署最后一步要「重新启用 ioto-settings 并写回 community-plugins.json」，
 * 写回逻辑错了会导致用户重启后被禁用；Templater 的 trigger_on_file_creation
 * 临时关闭 / 恢复错了会让批量写笔记时触发模板。这两处都在单测里钉住。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PluginService } from '../src/services/plugin-service.ts';
import { TemplaterService } from '../src/services/templater-service.ts';

function createApp({ files = {}, enabled = [], hasPlugins = true } = {}) {
	const writes = [];
	const calls = [];
	const app = {
		vault: {
			configDir: '.obsidian',
			adapter: {
				async exists(path) {
					return path in files;
				},
				async read(path) {
					return files[path];
				},
				async write(path, content) {
					writes.push({ path, content });
					files[path] = content;
				},
			},
		},
	};
	if (hasPlugins) {
		app.plugins = {
			manifests: {},
			enabledPlugins: new Set(enabled),
			async loadManifests() {
				calls.push('loadManifests');
			},
			async disablePlugin(id) {
				calls.push(`disable:${id}`);
			},
			async enablePlugin(id) {
				calls.push(`enable:${id}`);
			},
		};
	}
	return { app, calls, writes, files };
}

test('reloadAndEnablePlugin 刷新 manifest → 启用 → 追加到 community-plugins.json', async () => {
	const { app, calls, writes } = createApp({
		files: { '.obsidian/community-plugins.json': '["other-plugin"]' },
	});
	await PluginService.reloadAndEnablePlugin(app, 'ioto-settings');

	assert.deepEqual(calls, ['loadManifests', 'enable:ioto-settings']);
	assert.equal(writes.length, 1);
	assert.equal(writes[0].path, '.obsidian/community-plugins.json');
	assert.deepEqual(JSON.parse(writes[0].content), [
		'other-plugin',
		'ioto-settings',
	]);
});

test('reloadAndEnablePlugin 对已启用的插件先禁用再启用', async () => {
	const { app, calls } = createApp({ enabled: ['ioto-settings'] });
	await PluginService.reloadAndEnablePlugin(app, 'ioto-settings');

	assert.deepEqual(calls, [
		'loadManifests',
		'disable:ioto-settings',
		'enable:ioto-settings',
	]);
});

test('reloadAndEnablePlugin 在清单已包含该插件时不重写文件', async () => {
	const { app, writes } = createApp({
		files: { '.obsidian/community-plugins.json': '["ioto-settings"]' },
	});
	await PluginService.reloadAndEnablePlugin(app, 'ioto-settings');
	assert.equal(writes.length, 0);
});

test('reloadAndEnablePlugin 在 community-plugins.json 损坏时仍能启用并重建清单', async () => {
	const { app, writes } = createApp({
		files: { '.obsidian/community-plugins.json': '{not json' },
	});
	await PluginService.reloadAndEnablePlugin(app, 'ioto-settings');

	assert.equal(writes.length, 1);
	assert.deepEqual(JSON.parse(writes[0].content), ['ioto-settings']);
});

test('reloadAndEnablePlugin 在没有 app.plugins 时安全返回', async () => {
	const { app, writes } = createApp({ hasPlugins: false });
	await assert.doesNotReject(() =>
		PluginService.reloadAndEnablePlugin(app, 'ioto-settings'),
	);
	assert.equal(writes.length, 0);
});

test('getPluginSetting 读取已安装插件的设置，未安装时返回 null', () => {
	const installed = new PluginService(
		{ plugins: { plugins: { templater: { settings: { flag: true } } } } },
		'templater',
	);
	assert.equal(installed.getPluginSetting('flag'), true);
	assert.equal(installed.getPluginSetting('missing'), undefined);

	const absent = new PluginService({ plugins: { plugins: {} } }, 'templater');
	assert.equal(absent.getPluginSetting('flag'), null);
});

test('TemplaterService 写设置并通知事件处理器重新挂载触发器', async () => {
	const calls = [];
	const templater = {
		settings: { trigger_on_file_creation: true },
		async save_settings() {
			calls.push('save');
		},
		event_handler: {
			async update_trigger_file_on_creation() {
				calls.push('refresh-trigger');
			},
		},
	};
	const app = { plugins: { plugins: { 'templater-obsidian': templater } } };

	const service = new TemplaterService(app);
	await service.setTemplaterSetting('trigger_on_file_creation', false);

	assert.equal(templater.settings.trigger_on_file_creation, false);
	assert.deepEqual(calls, ['save', 'refresh-trigger']);

	await service.setTemplaterSetting('another_setting', 1);
	assert.equal(templater.settings.another_setting, 1);
	assert.deepEqual(calls, ['save', 'refresh-trigger', 'save']);
});

test('TemplaterService 在未安装 Templater 时静默跳过', async () => {
	const service = new TemplaterService({ plugins: { plugins: {} } });
	await assert.doesNotReject(() =>
		service.setTemplaterSetting('trigger_on_file_creation', false),
	);
});
