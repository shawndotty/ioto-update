/**
 * `src/services/github-service.ts` —— release 文件获取、manifest 缓存、安装落盘。
 *
 * 这里的分层很关键：优先 `releases/latest/download/{file}` 直连（不占 API 配额），
 * 失败才降级到 REST API。任何一层改动都可能让「检查更新」在限流时直接失效，
 * 因此三条路径都单独覆盖。网络用 requestUrl 桩替换。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { GithubService } from '../src/services/github-service.ts';
import {
	notices,
	resetRequestUrlHandler,
	setRequestUrlHandler,
} from './stubs/obsidian.mjs';

const REPO = 'https://github.com/shawndotty/ioto-dashboard';
const MANIFEST = { id: 'ioto-dashboard', name: 'IOTO Dashboard', version: '1.2.3' };

function useRequest(handler) {
	const calls = [];
	setRequestUrlHandler(async (options) => {
		calls.push(options.url);
		return handler(options.url);
	});
	return calls;
}

function textResponse(text) {
	return { status: 200, text };
}

test.afterEach(() => {
	resetRequestUrlHandler();
	GithubService.clearManifestCache();
	notices.length = 0;
});

test('getLatestPluginManifest 直连 releases/latest/download 获取 manifest', async () => {
	const calls = useRequest((url) => {
		assert.equal(
			url,
			'https://github.com/shawndotty/ioto-dashboard/releases/latest/download/manifest.json',
		);
		return textResponse(JSON.stringify(MANIFEST));
	});

	assert.deepEqual(await GithubService.getLatestPluginManifest(REPO), MANIFEST);
	assert.equal(calls.length, 1);
});

test('getLatestPluginManifest 在 manifest 缺 name 时回落到 id', async () => {
	useRequest(() =>
		textResponse(JSON.stringify({ id: 'ioto-dashboard', version: '1.0.0' })),
	);
	assert.deepEqual(await GithubService.getLatestPluginManifest(REPO), {
		id: 'ioto-dashboard',
		name: 'ioto-dashboard',
		version: '1.0.0',
	});
});

test('getLatestPluginManifest 命中缓存后不再发请求，清缓存后重新请求', async () => {
	const calls = useRequest(() => textResponse(JSON.stringify(MANIFEST)));

	await GithubService.getLatestPluginManifest(REPO);
	await GithubService.getLatestPluginManifest(REPO);
	assert.equal(calls.length, 1);

	GithubService.clearManifestCache(REPO);
	await GithubService.getLatestPluginManifest(REPO);
	assert.equal(calls.length, 2);
});

test('getLatestPluginManifest 直连失败时返回 null，不降级到 REST API', async () => {
	// 检查更新走的是「不占 API 配额」的直连路径；直连不到就视为查不到，
	// 避免用户在限流时反而被 REST API 拖住。安装路径才有 API 降级（见下一条）。
	const calls = useRequest(() => {
		throw new Error('404 Not Found');
	});

	assert.equal(await GithubService.getLatestPluginManifest(REPO), null);
	assert.equal(calls.length, 1);
});

test('installPluginFrom 直连失败时降级到 REST API 并写入文件', async () => {
	const calls = useRequest((url) => {
		if (url.includes('/releases/latest/download/')) {
			throw new Error('404 Not Found');
		}
		if (url === 'https://api.github.com/repos/shawndotty/ioto-dashboard/releases/latest') {
			return {
				status: 200,
				json: {
					assets: [
						{
							name: 'manifest.json',
							browser_download_url: 'https://objects.example/manifest.json',
						},
						{
							name: 'main.js',
							browser_download_url: 'https://objects.example/main.js',
						},
					],
				},
			};
		}
		if (url === 'https://objects.example/manifest.json') {
			return textResponse(JSON.stringify(MANIFEST));
		}
		if (url === 'https://objects.example/main.js') {
			return textResponse('console.log(3)');
		}
		throw new Error(`unexpected url: ${url}`);
	});

	const writes = [];
	const app = {
		vault: {
			configDir: '.obsidian',
			adapter: {
				async exists() {
					return true;
				},
				async mkdir() {},
				async write(path, content) {
					writes.push({ path, content });
				},
			},
		},
		plugins: { manifests: {}, enabledPlugins: new Set() },
	};

	await GithubService.installPluginFrom(app, REPO, { autoReload: false });

	assert.deepEqual(
		writes.map((write) => write.path),
		[
			'.obsidian/plugins/ioto-dashboard/manifest.json',
			'.obsidian/plugins/ioto-dashboard/main.js',
		],
	);
	assert.ok(
		calls.includes('https://api.github.com/repos/shawndotty/ioto-dashboard/releases/latest'),
	);
});

test('getLatestPluginManifest 对非法 JSON / 缺 id / 非法仓库地址返回 null', async () => {
	useRequest(() => textResponse('not json'));
	assert.equal(await GithubService.getLatestPluginManifest(REPO), null);

	GithubService.clearManifestCache();
	useRequest(() => textResponse(JSON.stringify({ version: '1.0.0' })));
	assert.equal(await GithubService.getLatestPluginManifest(REPO), null);

	assert.equal(
		await GithubService.getLatestPluginManifest('https://example.com/foo'),
		null,
	);
});

test('installPluginFrom 写入 manifest / main.js / styles.css', async () => {
	useRequest((url) => {
		if (url.endsWith('/manifest.json')) return textResponse(JSON.stringify(MANIFEST));
		if (url.endsWith('/main.js')) return textResponse('console.log(1)');
		if (url.endsWith('/styles.css')) return textResponse('.a{}');
		throw new Error(`unexpected url: ${url}`);
	});

	const writes = [];
	const app = {
		vault: {
			configDir: '.obsidian',
			adapter: {
				async exists() {
					return true;
				},
				async mkdir() {},
				async write(path, content) {
					writes.push({ path, content });
				},
			},
		},
		plugins: { manifests: {}, enabledPlugins: new Set() },
	};

	await GithubService.installPluginFrom(app, REPO, { autoReload: false });

	assert.deepEqual(writes, [
		{ path: '.obsidian/plugins/ioto-dashboard/manifest.json', content: JSON.stringify(MANIFEST) },
		{ path: '.obsidian/plugins/ioto-dashboard/main.js', content: 'console.log(1)' },
		{ path: '.obsidian/plugins/ioto-dashboard/styles.css', content: '.a{}' },
	]);
});

test('installPluginFrom 在 styles.css 缺失时只写两个文件', async () => {
	useRequest((url) => {
		if (url.endsWith('/manifest.json')) return textResponse(JSON.stringify(MANIFEST));
		if (url.endsWith('/main.js')) return textResponse('console.log(1)');
		throw new Error('404');
	});

	const writes = [];
	const app = {
		vault: {
			configDir: '.obsidian',
			adapter: {
				async exists() {
					return true;
				},
				async mkdir() {},
				async write(path, content) {
					writes.push(path);
				},
			},
		},
		plugins: { manifests: {}, enabledPlugins: new Set() },
	};

	await GithubService.installPluginFrom(app, REPO, { autoReload: false });

	assert.deepEqual(writes, [
		'.obsidian/plugins/ioto-dashboard/manifest.json',
		'.obsidian/plugins/ioto-dashboard/main.js',
	]);
});

test('installPluginFrom 对已是最新版本 / 非法地址给出提示且不写文件', async () => {
	useRequest(() => textResponse(JSON.stringify(MANIFEST)));
	const writes = [];
	const app = {
		vault: {
			configDir: '.obsidian',
			adapter: {
				async exists() {
					return true;
				},
				async mkdir() {},
				async write(path) {
					writes.push(path);
				},
			},
		},
		plugins: {
			manifests: { 'ioto-dashboard': { version: '1.2.3' } },
			enabledPlugins: new Set(),
		},
	};

	notices.length = 0;
	await GithubService.installPluginFrom(app, REPO, { autoReload: false });
	assert.ok(notices.some((notice) => notice.includes('is already up to date')));
	assert.deepEqual(writes, []);

	notices.length = 0;
	await GithubService.installPluginFrom(app, 'https://example.com/foo');
	assert.ok(notices.includes('Invalid GitHub repository URL'));
});
