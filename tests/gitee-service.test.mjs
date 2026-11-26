/**
 * `src/services/gitee-service.ts` —— 三条获取路径与 manifest 缓存。
 *
 * Gitee 的 API 限流比 GitHub 更常见，因此实现里保留了「API → releases 页面抓 tag →
 * 直接下载」的降级链；master 分支早已不参与版本检测，两路都失败时 fail-closed 并提示。
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
		if (url.endsWith('/releases?per_page=20&direction=desc')) {
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
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/releases?per_page=20&direction=desc',
		'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/releases/42/attach_files',
		'https://gitee.example/manifest.json',
	]);
});

test('getLatestPluginManifest 在 API 失败时抓 releases 页面拿 tag 再下载', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/releases?per_page=20&direction=desc')) {
			throw new Error('rate limited');
		}
		if (url.endsWith('/releases')) {
			return { status: 200, text: releasesPageHtml({ pre: ['v2.0.0'] }) };
		}
		if (url.endsWith('/releases/download/v2.0.0/manifest.json')) {
			return { status: 200, text: JSON.stringify(MANIFEST) };
		}
		throw new Error(`unexpected url: ${url}`);
	});

	// HTML 页带官方 pre-version 标记，预发布通道能走通
	// 「抓页面 → 解析标记 → 选 tag → 下载 manifest」链。
	assert.deepEqual(
		await GiteeService.getLatestPluginManifest(REPO, 'prerelease'),
		MANIFEST,
	);
	assert.ok(
		calls.some((url) => url.endsWith('/releases/download/v2.0.0/manifest.json')),
		`未走 release 直链: ${calls.join(', ')}`,
	);
});

test('getLatestPluginManifest 在 API 与页面都失败时返回 null，不回落 master raw', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/releases?per_page=20&direction=desc')) {
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
	notices.length = 0;

	assert.equal(await GiteeService.getLatestPluginManifest(REPO), null);
	assert.ok(
		!calls.some((url) => url.includes('/raw/master/manifest.json')),
		'不得再请求 master raw',
	);
	assert.equal(notices.length, 1, '失败应给一次明确提示');
});

test('getLatestPluginManifest 命中缓存后不再发请求，清缓存后重新请求', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/releases?per_page=20&direction=desc')) {
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
		if (url.endsWith('/releases?per_page=20&direction=desc')) {
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
	assert.ok(calls[0].includes('/repos/johnnylearns/ioto-dashboard/releases?per_page=20&direction=desc'));

	GiteeService.clearManifestCache();
	await GiteeService.getLatestPluginManifest(
		'https://gitee.com/johnnylearns/ioto-dashboard.git',
	);
	assert.ok(
		calls.at(-3).includes('/repos/johnnylearns/ioto-dashboard/releases?per_page=20&direction=desc'),
		'应去掉 .git 后缀',
	);
});

test('installPluginFrom 通过 API 附件写入插件目录', async () => {
	useRequest((url) => {
		if (url.endsWith('/releases?per_page=20&direction=desc')) {
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
		if (url.endsWith('/releases?per_page=20&direction=desc')) {
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

// ---------------------------------------------------------------------------
// Pre-Release 通道（release 列表过滤 + HTML fallback 判据 + 越权修复）
// ---------------------------------------------------------------------------

const GITEE_RELEASE_LIST_URL =
	'https://gitee.com/api/v5/repos/johnnylearns/ioto-dashboard/releases?per_page=20&direction=desc';

function giteeRelease(id, version, prerelease, published) {
	return {
		id,
		tag_name: `v${version}`,
		prerelease,
		created_at: published,
	};
}

function useGiteeChannelRequest({
	preVersion = '2.0.1',
	stableVersion = '2.0.0',
} = {}) {
	const stableManifestUrl = `https://gitee.example/stable-${stableVersion}.json`;
	const preManifestUrl = `https://gitee.example/pre-${preVersion}.json`;
	const calls = useRequest((url) => {
		if (url === GITEE_RELEASE_LIST_URL) {
			return {
				status: 200,
				json: [
					giteeRelease(1, stableVersion, false, '2026-11-20T10:00:00Z'),
					giteeRelease(2, preVersion, true, '2026-11-26T10:00:00Z'),
				],
			};
		}
		if (url.endsWith('/releases/1/attach_files')) {
			return {
				status: 200,
				json: [
					{ name: 'manifest.json', browser_download_url: stableManifestUrl },
				],
			};
		}
		if (url.endsWith('/releases/2/attach_files')) {
			return {
				status: 200,
				json: [
					{ name: 'manifest.json', browser_download_url: preManifestUrl },
				],
			};
		}
		if (url === stableManifestUrl) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: stableVersion }),
			};
		}
		if (url === preManifestUrl) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: preVersion }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});
	return calls;
}

test('Gitee prerelease 通道：只取 prerelease=true 的 release', async () => {
	useGiteeChannelRequest();
	const result = await GiteeService.getLatestPluginManifest(
		REPO,
		'prerelease',
	);
	assert.equal(result.version, '2.0.1');
});

test('Gitee 正式通道：显式排除 prerelease（越权修复）', async () => {
	const calls = useGiteeChannelRequest();
	const result = await GiteeService.getLatestPluginManifest(REPO, 'stable');
	assert.equal(result.version, '2.0.0');
	assert.ok(calls.some((url) => url.endsWith('/releases/1/attach_files')));
	assert.ok(!calls.some((url) => url.endsWith('/releases/2/attach_files')));
});

/**
 * 真实 Gitee releases 页 sidebar 形态（2026-11-26 实测）：
 * `<a class='releases-sidebar-item' data-tag='v2.8.7' …>` 内含
 * `<span class='ui label pre-version'>预览版本</span>` / `latest-version 最新版`。
 */
function releasesPageHtml({ pre = [], stable = [] } = {}) {
	const item = (tag, labelClass, labelText) => {
		const number = tag.replace(/^v/, '');
		return `<a class='releases-sidebar-item' data-tag='${tag}' href='#release-${tag}'>` +
			`<span class='tag-text' title='${number}'>${number}</span>` +
			`<span class='ui label ${labelClass}'>${labelText}</span></a>`;
	};
	return [
		...pre.map((tag) => item(tag, 'pre-version', '预览版本')),
		...stable.map((tag) => item(tag, 'latest-version', '最新版')),
	].join('');
}

/** 旧形态（无通道标记）：覆盖 Gitee 改版后 data-tag 标记失效的兜底分支。 */
function legacyReleasesPageHtml(tags) {
	return tags
		.map(
			(tag) =>
				`<a href="/johnnylearns/ioto-dashboard/releases/download/${tag}/manifest.json">${tag}</a>`,
		)
		.join('');
}

test('403 → HTML fallback：预发布通道取 release 页最高 tag，绝不用 master 旧值', async () => {
	const calls = useRequest((url) => {
		if (url === GITEE_RELEASE_LIST_URL) return { status: 403, json: {} };
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			// 真机形态：pre-version v2.8.7 / latest-version v2.8.6、v2.4.2
			return {
				status: 200,
				text: releasesPageHtml({
					pre: ['v2.8.7'],
					stable: ['v2.8.6', 'v2.4.2'],
				}),
			};
		}
		if (url.endsWith('/raw/master/manifest.json')) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: '2.4.2' }),
			};
		}
		if (url.includes('/releases/download/')) {
			const version = url.match(/\/download\/v([^/]+)\/manifest\.json$/)?.[1];
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});
	notices.length = 0;

	const result = await GiteeService.getLatestPluginManifest(
		REPO,
		'prerelease',
	);
	assert.equal(result.version, '2.8.7');
	assert.ok(
		!calls.some((url) => url.includes('/raw/master/manifest.json')),
		'旧码会在此处取到 2.4.2',
	);
	assert.equal(notices.length, 0, 'API 403 但 HTML fallback 成功不应提示');
});

test('HTML 带官方中文档标记时，预发布通道选到预览版', async () => {
	useRequest((url) => {
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return {
				status: 200,
				text: releasesPageHtml({
					pre: ['v2.8.7'],
					stable: ['v2.8.6'],
				}),
			};
		}
		if (url.endsWith('/releases/download/v2.8.7/manifest.json')) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: '2.8.7' }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});

	const tag = await GiteeService.getLatestReleaseTagFromPage(
		'johnnylearns',
		'ioto-dashboard',
		'prerelease',
	);
	assert.equal(tag, 'v2.8.7');
});

test('HTML fallback 正式通道：Map 为空仍按官方标记选最新版，不选预览版', async () => {
	const calls = useRequest((url) => {
		if (url === GITEE_RELEASE_LIST_URL) return { status: 403, json: {} };
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return {
				status: 200,
				text: releasesPageHtml({
					pre: ['v2.0.1'],
					stable: ['v2.0.0'],
				}),
			};
		}
		if (url.endsWith('/releases/download/v2.0.0/manifest.json')) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: '2.0.0' }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});
	notices.length = 0;

	const result = await GiteeService.getLatestPluginManifest(REPO, 'stable');
	assert.equal(result.version, '2.0.0');
	assert.equal(notices.length, 0, 'API 403 但 HTML fallback 成功不应提示');
	assert.ok(
		!calls.some((url) => url.includes('/releases/download/v2.0.1/')),
		'正式通道不得下载预发布 tag 的 manifest',
	);
});

test('HTML fallback 正式通道：官方标记直接判通道，不依赖 API 回填的 Map', async () => {
	// 先走一次 API 成功路径，让 Map 回填 v2.0.0=false / v2.0.1=true
	useGiteeChannelRequest();
	const apiResult = await GiteeService.getLatestPluginManifest(REPO, 'stable');
	assert.equal(apiResult.version, '2.0.0');

	const calls = useRequest((url) => {
		if (url === GITEE_RELEASE_LIST_URL) return { status: 403, json: {} };
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return {
				status: 200,
				text: releasesPageHtml({
					pre: ['v2.0.1'],
					stable: ['v2.0.0'],
				}),
			};
		}
		if (url.endsWith('/releases/download/v2.0.0/manifest.json')) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: '2.0.0' }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});

	const result = await GiteeService.getLatestPluginManifest(REPO, 'stable');
	assert.equal(result.version, '2.0.0');
	assert.ok(
		!calls.some((url) => url.includes('/releases/download/v2.0.1/')),
		'正式通道不得下载预发布 tag',
	);
});

test('HTML fallback 预发布通道：API 403 下选 pre-version v2.0.1', async () => {
	useRequest((url) => {
		if (url === GITEE_RELEASE_LIST_URL) return { status: 403, json: {} };
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return {
				status: 200,
				text: releasesPageHtml({
					pre: ['v2.0.1'],
					stable: ['v2.0.0'],
				}),
			};
		}
		if (url.endsWith('/releases/download/v2.0.1/manifest.json')) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: '2.0.1' }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});

	const result = await GiteeService.getLatestPluginManifest(REPO, 'prerelease');
	assert.equal(result.version, '2.0.1');
});

test('无预览版仓库：预发布通道降级到 latest-version，不返回 null', async () => {
	useRequest((url) => {
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return { status: 200, text: releasesPageHtml({ stable: ['v1.3.0'] }) };
		}
		if (url.endsWith('/releases/download/v1.3.0/manifest.json')) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: '1.3.0' }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});

	const tag = await GiteeService.getLatestReleaseTagFromPage(
		'johnnylearns',
		'ioto-dashboard',
		'prerelease',
	);
	assert.equal(tag, 'v1.3.0');
});

test('版本单调性：预发布低于正式版时降级到正式版，避免降级安装', async () => {
	useRequest((url) => {
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return {
				status: 200,
				text: releasesPageHtml({
					pre: ['v1.9.0'],
					stable: ['v2.0.0'],
				}),
			};
		}
		if (url.endsWith('/releases/download/v2.0.0/manifest.json')) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: '2.0.0' }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});
	const tag = await GiteeService.getLatestReleaseTagFromPage(
		'johnnylearns',
		'ioto-dashboard',
		'prerelease',
	);
	assert.equal(tag, 'v2.0.0');
});

test('Gitee 改版兜底：无通道标记的旧形态页面 fail-closed，不猜测通道', async () => {
	const calls = useRequest((url) => {
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return {
				status: 200,
				text: legacyReleasesPageHtml(['v2.8.7', 'v2.8.6']),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});
	assert.equal(
		await GiteeService.getLatestReleaseTagFromPage(
			'johnnylearns',
			'ioto-dashboard',
			'stable',
		),
		null,
	);
	assert.equal(
		await GiteeService.getLatestReleaseTagFromPage(
			'johnnylearns',
			'ioto-dashboard',
			'prerelease',
		),
		null,
	);
	assert.ok(
		!calls.some((url) => url.includes('/releases/download/')),
		'兜底无通道标记时不得下载任何 release 资源',
	);
});

test('fallback 结果不写缓存：连续两次调用都重新请求', async () => {
	let apiCalls = 0;
	useRequest((url) => {
		if (url === GITEE_RELEASE_LIST_URL) {
			apiCalls += 1;
			return { status: 403, json: {} };
		}
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return { status: 200, text: releasesPageHtml({ pre: ['v2.8.7'] }) };
		}
		if (url.includes('/releases/download/')) {
			return {
				status: 200,
				text: JSON.stringify({ ...MANIFEST, version: '2.8.7' }),
			};
		}
		throw new Error(`unexpected url: ${url}`);
	});

	const first = await GiteeService.getLatestPluginManifest(
		REPO,
		'prerelease',
	);
	const second = await GiteeService.getLatestPluginManifest(
		REPO,
		'prerelease',
	);
	assert.equal(first.version, '2.8.7');
	assert.equal(second.version, '2.8.7');
	assert.equal(apiCalls, 2, '第二次仍应请求 API，fallback 不进 10 分钟缓存');
});

test('10 秒内多次检测失败只产生一条提示', async () => {
	useRequest((url) => {
		if (url === GITEE_RELEASE_LIST_URL) return { status: 403, json: {} };
		if (url.endsWith('/johnnylearns/ioto-dashboard/releases')) {
			return { status: 200, text: '<html>no release</html>' };
		}
		throw new Error(`unexpected url: ${url}`);
	});
	notices.length = 0;

	await GiteeService.getLatestPluginManifest(REPO, 'prerelease');
	await GiteeService.getLatestPluginManifest(REPO, 'prerelease');
	await GiteeService.getLatestPluginManifest(REPO, 'prerelease');
	assert.equal(notices.length, 1, '11 插件循环不应刷屏');
});

test('回归：release 列表必须显式降序，否则 Gitee 默认升序会让预发布用户取到旧版', async () => {
	const stableManifestUrl = 'https://gitee.example/asc-stable.json';
	const preManifestUrl = 'https://gitee.example/asc-pre.json';
	let listUrl = '';
	useRequest((url) => {
		if (url.includes('/releases?per_page=20')) {
			listUrl = url;
			// 模拟 Gitee 真实行为：不带 direction 时按创建时间升序，per_page=20 只拿到
			// 最旧 20 条（最新预发布在列表之外，取不到）；带 direction=desc 时降序，
			// 最新预发布排在最前。
			if (url.includes('direction=desc')) {
				return {
					status: 200,
					json: [
						giteeRelease(2, '2.0.1', true, '2026-11-26T10:00:00Z'),
						giteeRelease(1, '2.0.0', false, '2026-11-20T10:00:00Z'),
					],
				};
			}
			return {
				status: 200,
				json: [giteeRelease(1, '2.0.0', false, '2026-11-20T10:00:00Z')],
			};
		}
		if (url.endsWith('/releases/1/attach_files')) {
			return {
				status: 200,
				json: [
					{ name: 'manifest.json', browser_download_url: stableManifestUrl },
				],
			};
		}
		if (url.endsWith('/releases/2/attach_files')) {
			return {
				status: 200,
				json: [
					{ name: 'manifest.json', browser_download_url: preManifestUrl },
				],
			};
		}
		if (url === stableManifestUrl) {
			return { status: 200, text: JSON.stringify({ ...MANIFEST, version: '2.0.0' }) };
		}
		if (url === preManifestUrl) {
			return { status: 200, text: JSON.stringify({ ...MANIFEST, version: '2.0.1' }) };
		}
		throw new Error(`unexpected url: ${url}`);
	});

	const result = await GiteeService.getLatestPluginManifest(REPO, 'prerelease');
	assert.equal(result.version, '2.0.1');
	assert.ok(
		listUrl.includes('direction=desc'),
		'release 列表请求必须显式带 direction=desc',
	);
});
