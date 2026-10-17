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
