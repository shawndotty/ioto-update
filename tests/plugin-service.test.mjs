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

function createApp({
	files = {},
	enabled = [],
	manifests = {},
	hasPlugins = true,
} = {}) {
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
			manifests,
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

// ---------------------------------------------------------------------------
// R9：SlidesRup 的 id 迁移（`slides-rup` → `slidesrup`）
// ---------------------------------------------------------------------------

test('resolveInstalledPluginId 先认远端 id，再认旧 id 别名，都没有则为 null', () => {
	const direct = createApp({
		manifests: { slidesrup: { id: 'slidesrup', version: '1.6.5' } },
	});
	assert.equal(
		PluginService.resolveInstalledPluginId(direct.app, 'slidesrup'),
		'slidesrup',
	);

	const legacy = createApp({
		manifests: { 'slides-rup': { id: 'slides-rup', version: '1.6.3' } },
	});
	assert.equal(
		PluginService.resolveInstalledPluginId(legacy.app, 'slidesrup'),
		'slides-rup',
	);

	const absent = createApp({ manifests: {} });
	assert.equal(
		PluginService.resolveInstalledPluginId(absent.app, 'slidesrup'),
		null,
	);
	// 没有登记别名的插件不受影响
	assert.equal(
		PluginService.resolveInstalledPluginId(absent.app, 'text-popup'),
		null,
	);
});

test('getPluginDir 优先用 manifests 里的 dir，缺失时退回 configDir/plugins/<id>', () => {
	const withDir = createApp({
		manifests: {
			slidesrup: { id: 'slidesrup', version: '1.6.5', dir: '.obsidian/plugins/slidesrup' },
		},
	});
	assert.equal(
		PluginService.getPluginDir(withDir.app, 'slidesrup'),
		'.obsidian/plugins/slidesrup',
	);

	const noDir = createApp({
		manifests: { 'text-popup': { id: 'text-popup', version: '1.0.0' } },
	});
	assert.equal(
		PluginService.getPluginDir(noDir.app, 'text-popup'),
		'.obsidian/plugins/text-popup',
	);
});

test('readInstalledManifest 以磁盘为准，磁盘缺失才退回内存', async () => {
	const onDisk = createApp({
		files: {
			'.obsidian/plugins/slidesrup/manifest.json': JSON.stringify({
				id: 'slidesrup',
				version: '1.6.5',
			}),
		},
		manifests: {
			slidesrup: { id: 'slidesrup', version: '1.6.4', dir: '.obsidian/plugins/slidesrup' },
		},
	});
	assert.deepEqual(
		await PluginService.readInstalledManifest(onDisk.app, 'slidesrup'),
		{ id: 'slidesrup', version: '1.6.5' },
		'R5：内存版本滞后时必须读磁盘',
	);

	const memoryOnly = createApp({
		manifests: {
			'slidesrup': { id: 'slidesrup', version: '1.6.4', dir: '.obsidian/plugins/slidesrup' },
		},
	});
	assert.deepEqual(
		await PluginService.readInstalledManifest(memoryOnly.app, 'slidesrup'),
		{ id: 'slidesrup', version: '1.6.4' },
	);

	assert.equal(
		await PluginService.readInstalledManifest(memoryOnly.app, 'not-installed'),
		null,
	);
});

test('migratePluginId 原地替换并去重，不新增、不重排', async () => {
	const { app, writes } = createApp({
		files: {
			'.obsidian/community-plugins.json':
				'["dataview","slides-rup","text-popup"]',
		},
	});

	assert.equal(
		await PluginService.migratePluginId(app, 'slides-rup', 'slidesrup'),
		true,
	);
	assert.equal(writes.length, 1);
	assert.deepEqual(JSON.parse(writes[0].content), [
		'dataview',
		'slidesrup',
		'text-popup',
	]);
});

test('migratePluginId 在清单里没有旧 id 时不写文件', async () => {
	const { app, writes } = createApp({
		files: { '.obsidian/community-plugins.json': '["text-popup"]' },
	});
	assert.equal(
		await PluginService.migratePluginId(app, 'slides-rup', 'slidesrup'),
		false,
	);
	assert.equal(writes.length, 0);
});

test('migrateLegacyPluginIdIfNeeded 三个条件都满足才迁移', async () => {
	const baseFiles = {
		'.obsidian/community-plugins.json': '["slides-rup","text-popup"]',
		'.obsidian/plugins/slidesrup/manifest.json': JSON.stringify({
			id: 'slidesrup',
			version: '1.6.4',
		}),
	};

	// 条件满足：启用 + 磁盘 id 已换新
	const ok = createApp({
		files: { ...baseFiles },
		enabled: ['slides-rup'],
	});
	assert.equal(
		await PluginService.migrateLegacyPluginIdIfNeeded(ok.app, {
			remoteId: 'slidesrup',
			legacyId: 'slides-rup',
			pluginDir: '.obsidian/plugins/slidesrup',
		}),
		true,
	);
	assert.deepEqual(JSON.parse(ok.files['.obsidian/community-plugins.json']), [
		'slidesrup',
		'text-popup',
	]);

	// 用户原本未启用：不迁移、不新增
	const disabled = createApp({
		files: { ...baseFiles },
		enabled: [],
	});
	assert.equal(
		await PluginService.migrateLegacyPluginIdIfNeeded(disabled.app, {
			remoteId: 'slidesrup',
			legacyId: 'slides-rup',
			pluginDir: '.obsidian/plugins/slidesrup',
		}),
		false,
	);
	assert.equal(disabled.writes.length, 0);
	assert.deepEqual(
		JSON.parse(disabled.files['.obsidian/community-plugins.json']),
		['slides-rup', 'text-popup'],
	);

	// 磁盘 manifest 还是旧 id（没真换成新版）：不迁移
	const stale = createApp({
		files: {
			'.obsidian/community-plugins.json': '["slides-rup"]',
			'.obsidian/plugins/slidesrup/manifest.json': JSON.stringify({
				id: 'slides-rup',
				version: '1.6.3',
			}),
		},
		enabled: ['slides-rup'],
	});
	assert.equal(
		await PluginService.migrateLegacyPluginIdIfNeeded(stale.app, {
			remoteId: 'slidesrup',
			legacyId: 'slides-rup',
			pluginDir: '.obsidian/plugins/slidesrup',
		}),
		false,
	);
	assert.equal(stale.writes.length, 0);
});
