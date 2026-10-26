/**
 * `src/services/gitee-service.ts` —— 三条获取路径与 manifest 缓存。
 *
 * Gitee 的 API 限流比 GitHub 更常见，因此实现里保留了「API → releases 页面抓 tag →
 * 直接下载」的降级链；获取 manifest 时还有 master raw 的最后一层兜底。
 * 每一层都可能在真机上被用到，这里分别覆盖。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { GiteeService } from '../src/services/gitee-service.ts';
import {
	notices,
	resetRequestUrlHandler,
	setRequestUrlHandler,
} from './stubs/obsidian.mjs';

const REPO = 'https://gitee.com/johnnylearns/ioto-dashboard';
const MANIFEST = { id: 'ioto-dashboard', name: 'IOTO Dashboard', version: '2.0.0' };

function useRequest(handler) {
	const calls = [];
	setRequestUrlHandler(async (options) => {
		calls.push(options.url);
		return handler(options.url);
	});
	return calls;
}

test.afterEach(() => {
	resetRequestUrlHandler();
	GiteeService.clearManifestCache();
	notices.length = 0;
});

test('getLatestPluginManifest 走 API：release → assets → 下载 manifest', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/releases/latest')) {
			return { status: 200, json: { id: 42, tag_name: 'v2.0.0' } };
		}
		if (url.endsWith('/releases/42/attach_files')) {
			return {
				status: 200,
				json: [
					{
						name: 'manifest.json',
						browser_download_url: 'https://gitee.example/manifest.json',
					},
				],
			};
		}
		if (url === 'https://gitee.example/manifest.json') {
			return { status: 200, text: JSON.stringify(MANIFEST) };
		}
		throw new Error(`unexpected url: ${url}`);
	});

	assert.deepEqual(await GiteeService.getLatestPluginManifest(REPO), MANIFEST);
	assert.deepEqual(calls, [
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/releases/latest',
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/releases/42/attach_files',
		'https://gitee.example/manifest.json',
	]);
});

test('getLatestPluginManifest 在 API 失败时抓 releases 页面拿 tag 再下载', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/releases/latest')) {
			throw new Error('rate limited');
		}
		if (url.endsWith('/releases')) {
			return {
				status: 200,
				text: '<a href="/johnnylearns/ioto-dashboard/releases/download/v2.0.0/manifest.json">',
			};
		}
		if (url.endsWith('/releases/download/v2.0.0/manifest.json')) {
			return { status: 200, text: JSON.stringify(MANIFEST) };
		}
		throw new Error(`unexpected url: ${url}`);
	});

	assert.deepEqual(await GiteeService.getLatestPluginManifest(REPO), MANIFEST);
	assert.ok(
		calls.some((url) => url.endsWith('/releases/download/v2.0.0/manifest.json')),
		`未走 release 直链: ${calls.join(', ')}`,
	);
});

test('getLatestPluginManifest 在页面也没有 tag 时回落 master raw', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/releases/latest')) {
			return { status: 500, json: {} };
		}
		if (url.endsWith('/releases')) {
			return { status: 200, text: '<html>no release</html>' };
		}
		if (url.endsWith('/raw/master/manifest.json')) {
			return { status: 200, text: JSON.stringify(MANIFEST) };
		}
		throw new Error(`unexpected url: ${url}`);
	});

	assert.deepEqual(await GiteeService.getLatestPluginManifest(REPO), MANIFEST);
	assert.equal(
		calls.at(-1),
		'https://gitee.com/johnnylearns/ioto-dashboard/raw/master/manifest.json',
	);
});

test('getLatestPluginManifest 命中缓存后不再发请求，清缓存后重新请求', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/releases/latest')) {
			return { status: 200, json: { id: 1, tag_name: 'v2.0.0' } };
		}
		if (url.endsWith('/attach_files')) {
			return {
				status: 200,
				json: [
					{
						name: 'manifest.json',
						browser_download_url: 'https://gitee.example/manifest.json',
					},
				],
			};
		}
		return { status: 200, text: JSON.stringify(MANIFEST) };
	});

	await GiteeService.getLatestPluginManifest(REPO);
	const afterFirst = calls.length;
	await GiteeService.getLatestPluginManifest(REPO);
	assert.equal(calls.length, afterFirst);

	GiteeService.clearManifestCache(REPO);
	await GiteeService.getLatestPluginManifest(REPO);
	assert.ok(calls.length > afterFirst);
});

test('parseRepoUrl 支持 owner/repo 与带 .git 的地址', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/releases/latest')) {
			return { status: 200, json: { id: 1, tag_name: 'v1' } };
		}
		if (url.endsWith('/attach_files')) {
			return {
				status: 200,
				json: [
					{
						name: 'manifest.json',
						browser_download_url: 'https://gitee.example/manifest.json',
					},
				],
			};
		}
		return { status: 200, text: JSON.stringify(MANIFEST) };
	});

	await GiteeService.getLatestPluginManifest('johnnylearns/ioto-dashboard');
	assert.ok(calls[0].includes('/repos/johnnylearns/ioto-dashboard/releases/latest'));

	GiteeService.clearManifestCache();
	await GiteeService.getLatestPluginManifest(
		'https://gitee.com/johnnylearns/ioto-dashboard.git',
	);
	assert.ok(
		calls.at(-3).includes('/repos/johnnylearns/ioto-dashboard/releases/latest'),
		'应去掉 .git 后缀',
	);
});

test('installPluginFrom 通过 API 附件写入插件目录', async () => {
	useRequest((url) => {
		if (url.endsWith('/releases/latest')) {
			return { status: 200, json: { id: 7, tag_name: 'v2.0.0' } };
		}
		if (url.endsWith('/releases/7/attach_files')) {
			return {
				status: 200,
				json: [
					{ name: 'manifest.json', browser_download_url: 'https://gitee.example/manifest.json' },
					{ name: 'main.js', browser_download_url: 'https://gitee.example/main.js' },
				],
			};
		}
		if (url.endsWith('/manifest.json')) {
			return { status: 200, text: JSON.stringify(MANIFEST) };
		}
		if (url.endsWith('/main.js')) {
			return { status: 200, text: 'console.log(2)' };
		}
		throw new Error(`unexpected url: ${url}`);
	});

	const writes = [];
	const app = {
		vault: {
			configDir: '.obsidian',
			adapter: {
				async exists() {
					return false;
				},
				async mkdir() {},
				async write(path, content) {
					writes.push({ path, content });
				},
			},
		},
		plugins: { manifests: {}, enabledPlugins: new Set() },
	};

	await GiteeService.installPluginFrom(app, REPO, { autoReload: false });

	assert.deepEqual(writes, [
		{ path: '.obsidian/plugins/ioto-dashboard/manifest.json', content: JSON.stringify(MANIFEST) },
		{ path: '.obsidian/plugins/ioto-dashboard/main.js', content: 'console.log(2)' },
	]);
});

test('installPluginFrom 对非法地址给出提示', async () => {
	useRequest(() => {
		throw new Error('should not be called');
	});
	notices.length = 0;
	await GiteeService.installPluginFrom({}, 'not-a-repo-url', { autoReload: false });
	assert.ok(notices.includes('Invalid Gitee repository URL'));
});

// ---------------------------------------------------------------------------
// 返回值契约 / 静音 / 版本判定 / 目录解析 / 旧 id 迁移
// ---------------------------------------------------------------------------

/** 造一个「有 release 附件」的 Gitee 桩：manifest + main.js。 */
function stubGiteeRelease(manifest, mainJs = 'console.log(9)') {
	return useRequest((url) => {
		if (url.endsWith('/releases/latest')) {
			return { status: 200, json: { id: 9, tag_name: `v${manifest.version}` } };
		}
		if (url.endsWith('/releases/9/attach_files')) {
			return {
				status: 200,
				json: [
					{ name: 'manifest.json', browser_download_url: 'https://gitee.example/manifest.json' },
					{ name: 'main.js', browser_download_url: 'https://gitee.example/main.js' },
				],
			};
		}
		if (url.endsWith('/manifest.json')) {
			return { status: 200, text: JSON.stringify(manifest) };
		}
		if (url.endsWith('/main.js')) {
			return { status: 200, text: mainJs };
		}
		throw new Error(`unexpected url: ${url}`);
	});
}

function createInstalledApp({ files = {}, manifests = {}, enabled = [] } = {}) {
	const writes = [];
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
				async mkdir() {},
				async write(path, content) {
					writes.push({ path, content });
					files[path] = content;
				},
			},
		},
		plugins: { manifests, enabledPlugins: new Set(enabled) },
	};
	return { app, writes, files };
}

test('installPluginFrom 返回 updated 并带上前后版本', async () => {
	stubGiteeRelease(MANIFEST);
	const { app, writes } = createInstalledApp({
		manifests: {
			'ioto-dashboard': { id: 'ioto-dashboard', version: '1.0.0', dir: '.obsidian/plugins/ioto-dashboard' },
		},
	});

	const result = await GiteeService.installPluginFrom(app, REPO, {
		autoReload: false,
		silent: true,
	});

	assert.equal(result.status, 'updated');
	assert.equal(result.pluginId, 'ioto-dashboard');
	assert.equal(result.fromVersion, '1.0.0');
	assert.equal(result.toVersion, '2.0.0');
	assert.equal(writes.length, 2);
});

test('本地版本等于远端时返回 up-to-date，且不写任何文件', async () => {
	stubGiteeRelease(MANIFEST);
	const { app, writes } = createInstalledApp({
		manifests: {
			'ioto-dashboard': { id: 'ioto-dashboard', version: '2.0.0', dir: '.obsidian/plugins/ioto-dashboard' },
		},
	});

	const result = await GiteeService.installPluginFrom(app, REPO, {
		autoReload: false,
		silent: true,
	});

	assert.equal(result.status, 'up-to-date');
	assert.deepEqual(writes, []);
});

test('本地版本高于远端（开发版）时返回 dev-version，不降级', async () => {
	stubGiteeRelease(MANIFEST);
	const { app, writes } = createInstalledApp({
		manifests: {
			'ioto-dashboard': { id: 'ioto-dashboard', version: '3.0.0', dir: '.obsidian/plugins/ioto-dashboard' },
		},
	});

	const result = await GiteeService.installPluginFrom(app, REPO, {
		autoReload: false,
		silent: true,
	});

	assert.equal(result.status, 'dev-version');
	assert.equal(result.fromVersion, '3.0.0');
	assert.deepEqual(writes, [], '开发版绝不能被降级覆盖');
});

test('silent 为真时不发任何 Notice', async () => {
	stubGiteeRelease(MANIFEST);
	const { app } = createInstalledApp();
	notices.length = 0;

	await GiteeService.installPluginFrom(app, REPO, {
		autoReload: false,
		silent: true,
	});

	assert.deepEqual(notices, []);
});

test('写入目录取 manifests 的 dir，而不是用 id 拼路径', async () => {
	stubGiteeRelease({ ...MANIFEST, id: 'slidesrup' });
	const { app, writes } = createInstalledApp({
		manifests: {
			slidesrup: { id: 'slidesrup', version: '1.6.4', dir: '.obsidian/plugins/slidesrup' },
		},
	});

	await GiteeService.installPluginFrom(
		app,
		'https://gitee.com/johnnylearns/slidesrup',
		{ autoReload: false, silent: true },
	);

	assert.deepEqual(
		writes.map((write) => write.path),
		['.obsidian/plugins/slidesrup/manifest.json', '.obsidian/plugins/slidesrup/main.js'],
	);
});

test('R9：旧 id 安装后写盘并把 community-plugins.json 原地迁移到新 id', async () => {
	const remoteManifest = {
		id: 'slidesrup',
		name: 'SlidesRup',
		version: '1.6.4',
	};
	stubGiteeRelease(remoteManifest);
	const { app, writes } = createInstalledApp({
		files: {
			'.obsidian/community-plugins.json': '["dataview","slides-rup","text-popup"]',
			'.obsidian/plugins/slidesrup/manifest.json': JSON.stringify({
				id: 'slides-rup',
				version: '1.6.3',
			}),
		},
		manifests: {
			'slides-rup': { id: 'slides-rup', version: '1.6.3', dir: '.obsidian/plugins/slidesrup' },
		},
		enabled: ['slides-rup'],
	});

	const result = await GiteeService.installPluginFrom(
		app,
		'https://gitee.com/johnnylearns/slidesrup',
		{ autoReload: false, silent: true },
	);

	assert.equal(result.status, 'updated');
	assert.equal(result.legacyId, 'slides-rup');
	assert.equal(result.fromVersion, '1.6.3', '旧 id 也要判出已安装并读出版本');

	const communityWrite = writes.find((write) =>
		write.path.endsWith('community-plugins.json'),
	);
	assert.ok(communityWrite, '应写回 community-plugins.json');
	assert.deepEqual(JSON.parse(communityWrite.content), [
		'dataview',
		'slidesrup',
		'text-popup',
	], '顺序不变、旧 id 换新 id、不重复');
});

test('R9：用户原本未启用旧 id 时迁移不新增条目', async () => {
	stubGiteeRelease({
		id: 'slidesrup',
		name: 'SlidesRup',
		version: '1.6.4',
	});
	const { app, writes } = createInstalledApp({
		files: {
			'.obsidian/community-plugins.json': '["dataview"]',
			'.obsidian/plugins/slidesrup/manifest.json': JSON.stringify({
				id: 'slides-rup',
				version: '1.6.3',
			}),
		},
		manifests: {
			'slides-rup': { id: 'slides-rup', version: '1.6.3', dir: '.obsidian/plugins/slidesrup' },
		},
		enabled: [],
	});

	await GiteeService.installPluginFrom(
		app,
		'https://gitee.com/johnnylearns/slidesrup',
		{ autoReload: false, silent: true },
	);

	assert.equal(
		writes.some((write) => write.path.endsWith('community-plugins.json')),
		false,
		'未启用就不该动 community-plugins.json',
	);
});
