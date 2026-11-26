/**
 * `src/services/command-service.ts` —— 命令注册闸门与一键部署编排。
 *
 * 两个关键语义：
 * 1. 未授权（userChecked / API Key / 邮箱任一不满足）时**一条命令都不注册**，
 *    命令面板里不会留下点了就报错的死命令；
 * 2. 「一键部署」只跑 isPartOfAllUpdates 的 5 个数据源，并只给 MyIOTO 打 intialSetup。
 *
 * 这里只替换 NocoDB 同步与安装/网络边界（一键部署会顺带装两个核心插件，
 * installPluginByKey 被统一 stub 以收集参数），断言的是编排本身。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_SETTINGS,
} from '../src/models/default-settings.ts';
import { CommandService } from '../src/services/command-service.ts';
import { GithubService } from '../src/services/github-service.ts';
import { GiteeService } from '../src/services/gitee-service.ts';
import { notices } from './stubs/obsidian.mjs';

const VALID_API_KEY = `pat${'a'.repeat(78)}.${'b'.repeat(20)}`;

/** 各数据源使用互不相同的 viewID，便于在编排结果里识别是哪一个。 */
const SETTINGS = {
	...DEFAULT_SETTINGS,
	updateAPIKey: VALID_API_KEY,
	updateAPIKeyIsValid: true,
	userChecked: true,
	userEmail: 'user@example.com',
	iotoFrameworkPath: '0-辅助/IOTO',
	updateIDs: {
		iotoCore: { baseID: 'appCore', tableID: 'tblCore', viewID: 'viwCore' },
		myIotoFull: {
			baseID: 'appMy',
			tableID: 'tblMy',
			viewID: 'viwMy',
		},
		iotoSettingPlugin: {
			baseID: 'appSetting',
			tableID: 'tblSetting',
			viewID: 'viwSetting',
		},
		iotoCssSnippets: {
			baseID: 'appCss',
			tableID: 'tblCss',
			viewID: 'viwCss',
		},
		iotoHelpDocs: {
			baseID: 'appHelp',
			tableID: 'tblHelp',
			viewID: 'viwHelp',
		},
		iotoSkills: {
			baseID: 'appSkills',
			tableID: 'tblSkills',
			viewID: 'viwSkills',
		},
	},
};

function createApp(options = {}) {
	const reloads = [];
	const enabled = [];
	const app = {
		vault: {
			configDir: '.obsidian',
			getFiles: () =>
				(options.files ?? []).map((filePath) => ({ path: filePath })),
			adapter: {
				async exists() {
					return true;
				},
				async read() {
					return '[]';
				},
				async write() {},
			},
		},
		commands: {
			executeCommandById(id) {
				reloads.push(id);
			},
		},
		plugins: {
			plugins: { ...(options.plugins ?? {}) },
			manifests: { ...(options.manifests ?? {}) },
			enabledPlugins: new Set(options.enabled ?? []),
			async loadManifests() {},
			async disablePlugin() {},
			async enablePlugin(id) {
				enabled.push(id);
			},
		},
	};
	return { app, reloads, enabled };
}

/** 造一个命令服务，并返回它注册到的命令表。 */
function createService(settingsOverrides = {}, options = {}) {
	const { app, reloads, enabled } = createApp(options);
	const settings = { ...SETTINGS, ...settingsOverrides };
	// plugin.settings 与构造参数里的 settings 保持两份对象：
	// 「改设置立即生效」用例要靠它区分「读插件设置」与「读构造时快照」。
	const saves = [];
	const plugin = {
		app,
		settings: { ...settings },
		saveSettings: async () => {
			saves.push(plugin.settings.myIotoDeployed);
		},
	};
	const commands = [];
	// templater 桩默认「创建时触发」为关闭（getPluginSetting 返回 null），
	// 现有用例因此不会触发 setTemplaterSetting；options.templaterTrigger 可打开它。
	const templaterCalls = [];
	const templater = {
		getPluginSetting: () => (options.templaterTrigger ? true : null),
		setTemplaterSetting: async (key, value) => {
			templaterCalls.push([key, value]);
		},
	};
	const service = new CommandService(
		app,
		plugin,
		(command) => commands.push(command),
		settings,
		templater,
		{ getUpdateIDs: async () => ({ updateIDs: {}, userChecked: true }) },
	);
	// 一键部署会顺带装两个核心插件；安装边界统一 stub，断言的是编排本身。
	// 安装命令用例（install-*）走真实下载分派，用返回的 originalInstallPluginByKey 恢复。
	const installedKeys = [];
	const installedOptions = [];
	const originalInstallPluginByKey = service.installPluginByKey;
	service.installPluginByKey = async (key, options) => {
		installedKeys.push(key);
		installedOptions.push(options);
		// 静音编排要读 result.status；失败用例自行覆写这个 stub。
		return { status: 'up-to-date', pluginId: key };
	};
	// 测试环境没有 DOM：用轻量面板替身接住事件；requestReload 立即执行真实回调，
	// 让既有的 reloads 断言仍指向「是否请求过重载」这一语义。
	const panelEvents = [];
	const reloadRequests = [];
	service.createProgressPanel = () => ({
		handle: (event) => panelEvents.push(event),
		requestReload: (onReload) => {
			reloadRequests.push(onReload);
			onReload();
		},
		destroy: () => {},
	});
	return {
		service,
		commands,
		app,
		reloads,
		enabled,
		plugin,
		saves,
		templaterCalls,
		installedKeys,
		installedOptions,
		originalInstallPluginByKey,
		panelEvents,
		reloadRequests,
	};
}

/** 取框架阶段的明细行（静音后 skipped / failed 只能从这里读到）。 */
function frameworkItems(events) {
	const end = events.find(
		(event) => event.type === 'stage-end' && event.stage === 'framework',
	);
	return end?.result.items ?? [];
}

test('授权信息不完整时一条命令都不注册', () => {
	const cases = [
		{ userChecked: false },
		{ updateAPIKeyIsValid: false },
		{ updateAPIKey: 'short' },
		{ userEmail: 'not-an-email' },
	];

	for (const overrides of cases) {
		const { service, commands } = createService(overrides);
		service.registerCommands();
		assert.deepEqual(
			commands.map((command) => command.id),
			[],
			`不应注册命令: ${JSON.stringify(overrides)}`,
		);
	}
});

test('授权通过时注册 5 个数据源命令 + 一键部署 + 安装类命令', () => {
	const { service, commands } = createService();
	service.registerCommands();

	assert.deepEqual(
		commands.map((command) => command.id),
		[
			'get-core-files',
			'get-help-doc',
			'get-myioto',
			'get-css',
			'get-setting-plugin',
			'get-user-sync-scripts',
			'run-all-updates',
			'full-update-ioto',
			'get-skills',
			'update-user-permissions',
			'install-itg-from-github',
			'install-ioto-dashboard-from-github',
			'install-ioto-tasks-center-from-github',
			'install-text-popup-from-github',
			'install-my-text-tools-from-github',
			'install-slidesrup-from-github',
			'install-airtable-fetcher-from-github',
			'install-feishu-fetcher-from-github',
			'install-vika-fetcher-from-github',
			'install-sync-with-mdb-from-github',
		],
	);
});

test('同步脚本生成器的安装命令受 iotoSettingPlugin.viewID 白名单控制', () => {
	const blocked = createService();
	blocked.service.registerCommands();
	assert.equal(
		blocked.commands.some((command) => command.id === 'install-ssg-from-github'),
		false,
	);

	const allowed = createService({
		updateIDs: {
			...SETTINGS.updateIDs,
			iotoSettingPlugin: {
				baseID: 'appSetting',
				tableID: 'tblSetting',
				viewID: 'viwZvtQy1GDWu00sA',
			},
		},
	});
	allowed.service.registerCommands();
	assert.equal(
		allowed.commands.some((command) => command.id === 'install-ssg-from-github'),
		true,
	);
});

test('一键部署只跑 isPartOfAllUpdates 的 5 个数据源，并只给 MyIOTO 打 intialSetup', async () => {
	const { service, commands, enabled, reloads, installedKeys } = createService();
	service.registerCommands();

	const calls = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		calls.push(tableConfig);
	};

	await commands.find((command) => command.id === 'run-all-updates').callback();

	assert.deepEqual(
		calls.map((config) => config.viewID),
		['viwCore', 'viwHelp', 'viwMy', 'viwCss', 'viwSetting'],
	);
	assert.equal(calls[2].intialSetup, true, '只有 MyIOTO 需要 initial setup');
	for (const config of [calls[0], calls[1], calls[3], calls[4]]) {
		assert.equal(config.intialSetup, undefined);
	}
	assert.equal(calls[0].targetFolderPath, '0-辅助/IOTO');
	assert.equal(calls[3].targetFolderPath, '.obsidian');
	assert.equal(calls[4].targetFolderPath, '.obsidian');
	assert.equal(calls[1].targetFolderPath, '0-辅助/IOTO');
	assert.equal(calls[2].targetFolderPath, '0-辅助/IOTO');

	assert.deepEqual(enabled, ['ioto-settings'], '全部成功后重新启用设置插件');
	assert.deepEqual(reloads, ['app:reload']);
	assert.deepEqual(
		installedKeys,
		['ioto-tasks-center', 'ioto-dashboard'],
		'一键部署自动安装两个核心插件，顺序固定',
	);
});

test('框架同步全失败时仍尝试安装两个核心插件，但不启用 ioto-settings 也不重载', async () => {
	const { service, commands, enabled, reloads, installedKeys } = createService();
	service.registerCommands();
	service.executeNocoDBCommand = async () => {
		throw new Error('boom');
	};

	await commands.find((command) => command.id === 'run-all-updates').callback();

	assert.deepEqual(
		installedKeys,
		['ioto-tasks-center', 'ioto-dashboard'],
		'插件下载与 NocoDB 框架同步是两条独立路径，框架失败不影响安装尝试',
	);
	assert.deepEqual(enabled, [], '框架全失败时不启用 ioto-settings');
	assert.deepEqual(reloads, [], '框架全失败时不重载');
});

test('单个核心插件安装失败被隔离，另一个仍被尝试且不影响其余编排', async () => {
	const { service, commands, enabled, reloads, installedKeys } = createService();
	service.registerCommands();
	service.executeNocoDBCommand = async () => {};
	service.installPluginByKey = async (key) => {
		installedKeys.push(key);
		if (key === 'ioto-tasks-center') throw new Error('boom');
		return { status: 'up-to-date', pluginId: key };
	};

	const originalError = console.error;
	console.error = () => {};
	try {
		await commands.find((command) => command.id === 'run-all-updates').callback();
	} finally {
		console.error = originalError;
	}

	assert.deepEqual(
		installedKeys,
		['ioto-tasks-center', 'ioto-dashboard'],
		'for 循环未被第一个 key 的异常中断，第二个仍被尝试',
	);
	assert.deepEqual(enabled, ['ioto-settings'], '安装失败不影响 ioto-settings 启用');
	assert.deepEqual(reloads, ['app:reload'], '安装失败不影响末尾 app:reload');
});

test('开启跳过设置且已部署过，一键部署只跑其余 4 个数据源并在面板标记跳过', async () => {
	const { service, commands, enabled, reloads, panelEvents } = createService({
		skipMyIotoInAllUpdates: true,
		myIotoDeployed: true,
	});
	service.registerCommands();

	const calls = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		calls.push(tableConfig);
	};

	notices.length = 0;
	await commands.find((command) => command.id === 'run-all-updates').callback();

	assert.deepEqual(
		calls.map((config) => config.viewID),
		['viwCore', 'viwHelp', 'viwCss', 'viwSetting'],
	);
	assert.deepEqual(notices, [], '部署全程静音');
	assert.deepEqual(
		frameworkItems(panelEvents).map((item) => [item.label, item.status]),
		[
			['Update Core Files', 'updated'],
			['Update Help Docs', 'updated'],
			['Update MYIOTO Templates', 'skipped'],
			['Update CSS Snippets', 'updated'],
			['Update IOTO Framwork Setting Plugin', 'updated'],
		],
		'静音后「已跳过」由面板明细呈现',
	);
	assert.deepEqual(enabled, ['ioto-settings']);
	assert.deepEqual(reloads, ['app:reload']);
});

test('开启跳过设置后，单独执行「更新MYIOTO模板」仍然更新 MyIOTO', async () => {
	const { service, commands } = createService({
		skipMyIotoInAllUpdates: true,
	});
	service.registerCommands();
	// 不覆写就会真的走 Modal：stub 的 open() 是空实现，await 会永久挂起
	service.askMyIotoSubFolderMode = async () => 'versioned';

	const calls = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		calls.push(tableConfig);
	};

	await commands.find((command) => command.id === 'get-myioto').callback();

	assert.deepEqual(calls.map((config) => config.viewID), ['viwMy']);
});

/** 单独跑一次「更新MYIOTO模板」，返回 executeNocoDBCommand 实际收到的配置。 */
async function runMyIotoCommand(service, commands, mode) {
	service.registerCommands();
	service.askMyIotoSubFolderMode = async () => mode;

	const calls = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		calls.push(tableConfig);
	};
	await commands.find((command) => command.id === 'get-myioto').callback();
	return calls;
}

test('选「不带版本号」时给 MyIOTO 配置打上 intialSetup', async () => {
	const { service, commands } = createService();
	const calls = await runMyIotoCommand(service, commands, 'unversioned');

	assert.equal(calls.length, 1);
	assert.equal(calls[0].viewID, 'viwMy');
	assert.equal(calls[0].intialSetup, true, '不归一化就会继续落版本目录');
});

test('选「带版本号」时配置与注册期一致，且不写 intialSetup', async () => {
	const { service, commands } = createService();
	const calls = await runMyIotoCommand(service, commands, 'versioned');

	assert.equal(calls.length, 1);
	assert.equal(calls[0].viewID, 'viwMy');
	assert.equal(calls[0].targetFolderPath, '0-辅助/IOTO');
	assert.notEqual(calls[0].intialSetup, true);
});

test('取消选择时零副作用：不发请求、不动 Templater、只提示取消', async () => {
	const { service, commands, templaterCalls } = createService(
		{},
		{ templaterTrigger: true },
	);
	service.registerCommands();
	service.askMyIotoSubFolderMode = async () => null;

	let executed = 0;
	service.executeNocoDBCommand = async () => {
		executed += 1;
	};

	notices.length = 0;
	await commands.find((command) => command.id === 'get-myioto').callback();

	assert.equal(executed, 0, '取消后不应发请求');
	assert.deepEqual(templaterCalls, [], '弹窗阶段不应关闭 Templater 触发');
	assert.ok(
		notices.includes('MYIOTO update cancelled.'),
		`缺少取消提示，实际: ${notices.join(' | ')}`,
	);
});

test('单命令连跑两次不会把上次的归一化选择粘到下一次', async () => {
	const { service, commands } = createService();
	service.registerCommands();

	const calls = [];
	service.executeNocoDBCommand = async (config) => {
		calls.push(config);
	};

	const run = commands.find((command) => command.id === 'get-myioto').callback;

	service.askMyIotoSubFolderMode = async () => 'unversioned';
	await run();
	service.askMyIotoSubFolderMode = async () => 'versioned';
	await run();

	assert.equal(calls[0].intialSetup, true);
	assert.notEqual(calls[1].intialSetup, true);
	assert.notEqual(calls[0], calls[1], '每次必须是新对象');
});

test('一键部署不询问子目录形式，MyIOTO 仍按一键部署逻辑归一化', async () => {
	const { service, commands } = createService();
	service.registerCommands();
	service.askMyIotoSubFolderMode = async () => {
		throw new Error('should not ask');
	};

	const calls = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		calls.push(tableConfig);
	};

	await commands.find((command) => command.id === 'run-all-updates').callback();

	assert.deepEqual(
		calls.map((config) => config.viewID),
		['viwCore', 'viwHelp', 'viwMy', 'viwCss', 'viwSetting'],
	);
	assert.equal(calls[2].intialSetup, true);
});

test('改设置后下一次一键部署立即生效，无需重载插件', async () => {
	const { service, commands, plugin } = createService({
		myIotoDeployed: true,
	});
	service.registerCommands();

	const calls = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		calls.push(tableConfig.viewID);
	};
	const run = () =>
		commands.find((command) => command.id === 'run-all-updates').callback();

	await run();
	assert.ok(calls.includes('viwMy'), '默认设置下应更新 MyIOTO');

	calls.length = 0;
	plugin.settings.skipMyIotoInAllUpdates = true;
	await run();
	assert.ok(!calls.includes('viwMy'), '开启后应跳过 MyIOTO');
});

test('首次部署时 skip 设置不生效，强制下载并写回 true', async () => {
	const run = createService(
		{ skipMyIotoInAllUpdates: true },
		{ files: [] },
	);
	run.service.registerCommands();

	const calls = [];
	run.service.executeNocoDBCommand = async (config) => {
		calls.push(config.viewID);
	};

	notices.length = 0;
	await run.commands
		.find((command) => command.id === 'run-all-updates')
		.callback();

	assert.deepEqual(calls, [
		'viwCore',
		'viwHelp',
		'viwMy',
		'viwCss',
		'viwSetting',
	]);
	assert.deepEqual(notices, [], '部署全程静音');
	assert.ok(
		frameworkItems(run.panelEvents).some(
			(item) =>
				item.label === 'Update MYIOTO Templates' &&
				item.status === 'updated',
		),
		'首次部署强制下载 MYIOTO，面板明细应为已更新而非已跳过',
	);
	assert.deepEqual(run.saves, [true]);
	assert.equal(run.plugin.settings.myIotoDeployed, true);
});

test('老用户本地已有 MyIOTO 内容时跳过并一次性迁移标记', async () => {
	const run = createService(
		{ skipMyIotoInAllUpdates: true },
		{
			files: [
				'0-辅助/IOTO/Templates/Templater/MyIOTO/a.md',
			],
		},
	);
	run.service.registerCommands();

	const calls = [];
	run.service.executeNocoDBCommand = async (config) => {
		calls.push(config.viewID);
	};

	notices.length = 0;
	await run.commands
		.find((command) => command.id === 'run-all-updates')
		.callback();

	assert.deepEqual(calls, ['viwCore', 'viwHelp', 'viwCss', 'viwSetting']);
	assert.deepEqual(notices, [], '部署全程静音');
	assert.ok(
		frameworkItems(run.panelEvents).some(
			(item) =>
				item.label === 'Update MYIOTO Templates' &&
				item.status === 'skipped',
		),
		'静音后「已跳过」由面板明细呈现',
	);
	assert.deepEqual(run.saves, [true], '老用户只做一次性迁移写回');
	assert.equal(run.plugin.settings.myIotoDeployed, true);
});

test('标记为 false 时即使本地有内容也强制下载（半途失败可重试）', async () => {
	const run = createService(
		{ skipMyIotoInAllUpdates: true, myIotoDeployed: false },
		{
			files: [
				'0-辅助/IOTO/Templates/Templater/MyIOTO/a.md',
			],
		},
	);
	run.service.registerCommands();

	const calls = [];
	run.service.executeNocoDBCommand = async (config) => {
		calls.push(config.viewID);
	};

	notices.length = 0;
	await run.commands
		.find((command) => command.id === 'run-all-updates')
		.callback();

	assert.ok(
		calls.includes('viwMy'),
		`标记为 false 时应强制下载，实际: ${calls.join(',')}`,
	);
	assert.deepEqual(notices, [], '部署全程静音');
	assert.ok(
		frameworkItems(run.panelEvents).some(
			(item) =>
				item.label === 'Update MYIOTO Templates' &&
				item.status === 'updated',
		),
		'强制下载成功后面板明细应为已更新',
	);
});

test('强制下载成功后把已部署标记写回 true', async () => {
	const run = createService({
		skipMyIotoInAllUpdates: true,
		myIotoDeployed: false,
	});
	run.service.registerCommands();
	run.service.executeNocoDBCommand = async () => {};

	await run.commands
		.find((command) => command.id === 'run-all-updates')
		.callback();

	assert.equal(run.plugin.settings.myIotoDeployed, true);
	assert.deepEqual(run.saves, [true]);
});

test('强制下载失败时标记写回 false，其余任务照常跑完', async () => {
	const run = createService({
		skipMyIotoInAllUpdates: true,
		myIotoDeployed: false,
	});
	run.service.registerCommands();

	const attempted = [];
	run.service.executeNocoDBCommand = async (config) => {
		attempted.push(config.viewID);
		if (config.viewID === 'viwMy') {
			throw new Error('boom');
		}
	};

	notices.length = 0;
	await run.commands
		.find((command) => command.id === 'run-all-updates')
		.callback();

	assert.deepEqual(attempted, [
		'viwCore',
		'viwHelp',
		'viwMy',
		'viwCss',
		'viwSetting',
	]);
	assert.equal(run.plugin.settings.myIotoDeployed, false);
	assert.deepEqual(run.saves, [false]);
	assert.deepEqual(notices, [], '部署全程静音');
	assert.ok(
		frameworkItems(run.panelEvents).some(
			(item) =>
				item.label === 'Update MYIOTO Templates' &&
				item.status === 'failed' &&
				item.detail === 'boom',
		),
		'失败原因由面板明细呈现',
	);
});

test('一键部署单个数据源失败时在面板给出明细且继续跑完其余任务', async () => {
	const { service, commands, panelEvents } = createService();
	service.registerCommands();

	const attempted = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		attempted.push(tableConfig.viewID);
		if (tableConfig.viewID === 'viwCss') {
			throw new Error('boom');
		}
	};

	notices.length = 0;
	await commands.find((command) => command.id === 'run-all-updates').callback();

	assert.deepEqual(attempted, [
		'viwCore',
		'viwHelp',
		'viwMy',
		'viwCss',
		'viwSetting',
	]);
	assert.deepEqual(notices, [], '部署全程静音');
	assert.ok(
		frameworkItems(panelEvents).some(
			(item) =>
				item.label === 'Update CSS Snippets' &&
				item.status === 'failed' &&
				item.detail === 'boom',
		),
		'失败原因由面板明细呈现',
	);
});

test('安装命令按 pluginDownloadSource 选择 GitHub / Gitee，并带上注册表里的仓库地址', async () => {
	const originalGithub = GithubService.installPluginFrom;
	const originalGitee = GiteeService.installPluginFrom;
	const installed = [];
	try {
		GithubService.installPluginFrom = async (_app, url) => {
			installed.push(`github:${url}`);
		};
		GiteeService.installPluginFrom = async (_app, url) => {
			installed.push(`gitee:${url}`);
		};

		const githubRun = createService({ pluginDownloadSource: 'github' });
		// 本用例测安装命令的真实下载分派，恢复被工厂 stub 的 installPluginByKey。
		githubRun.service.installPluginByKey = githubRun.originalInstallPluginByKey;
		githubRun.service.registerCommands();
		await githubRun.commands
			.find((command) => command.id === 'install-ioto-dashboard-from-github')
			.callback();

		const giteeRun = createService({ pluginDownloadSource: 'gitee' });
		giteeRun.service.installPluginByKey = giteeRun.originalInstallPluginByKey;
		giteeRun.service.registerCommands();
		await giteeRun.commands
			.find((command) => command.id === 'install-text-popup-from-github')
			.callback();
	} finally {
		GithubService.installPluginFrom = originalGithub;
		GiteeService.installPluginFrom = originalGitee;
	}

	assert.deepEqual(installed, [
		'github:https://github.com/shawndotty/ioto-dashboard',
		'gitee:https://gitee.com/johnnylearns/text-popup',
	]);
});

test('createNocoDBCommand 在同步抛错时用 Notice 展示错误信息', async () => {
	const { service, commands } = createService();
	service.registerCommands();
	service.executeNocoDBCommand = async () => {
		throw new Error('network down');
	};

	notices.length = 0;
	await commands.find((command) => command.id === 'get-core-files').callback();
	assert.ok(notices.includes('network down'));
});

// ---------------------------------------------------------------------------
// 一键更新完整 IOTO 的接线（编排器本身在 full-update.test.mjs 里）
// ---------------------------------------------------------------------------

const ALL_MANIFESTS = Object.fromEntries(
	[
		'ioto-tasks-center',
		'ioto-template-generator',
		'sync-script-generator',
		'ioto-dashboard',
		'text-popup',
		'my-text-tools',
		'slidesrup',
		'obsidian-airtable-fetcher',
		'obsidian-feishu-fetcher',
		'obsidian-vika-fetcher',
		'ob-sync-with-mdb',
	].map((id) => [id, { id, version: '1.0.0' }]),
);

/** 临时替换两个下载服务的 installPluginFrom，记录调用参数。 */
function stubInstall(handler) {
	const originalGithub = GithubService.installPluginFrom;
	const originalGitee = GiteeService.installPluginFrom;
	const calls = [];
	const wrap = (source) =>
		async (app, url, options) => {
			calls.push({ source, url, options });
			return handler({ source, url, options });
		};
	GithubService.installPluginFrom = wrap('github');
	GiteeService.installPluginFrom = wrap('gitee');
	return {
		calls,
		restore() {
			GithubService.installPluginFrom = originalGithub;
			GiteeService.installPluginFrom = originalGitee;
		},
	};
}

test('未安装的辅助插件直接跳过，不进下载队列', async () => {
	const { service } = createService({}, {
		manifests: { 'ob-sync-with-mdb': { id: 'ob-sync-with-mdb', version: '2.0.6' } },
	});
	const stub = stubInstall(async () => ({ status: 'up-to-date' }));

	try {
		const missing = await service.updateAuxPluginByKey('text-popup');
		assert.equal(missing.status, 'skipped');
		assert.deepEqual(stub.calls, [], '未安装就不该发任何下载请求');

		const installed = await service.updateAuxPluginByKey('ob-sync-with-mdb');
		assert.equal(installed.status, 'up-to-date');
		assert.deepEqual(stub.calls, [
			{
				source: 'gitee',
				url: 'https://gitee.com/johnnylearns/ob-sync-with-mdb',
				options: { autoReload: false, silent: true, channel: 'stable' },
			},
		], '编排链路必须静音且不自动重载');
	} finally {
		stub.restore();
	}
});

test('SSG 白名单外即使已安装也跳过，白名单内才下载', async () => {
	const blocked = createService({}, {
		manifests: { 'sync-script-generator': { id: 'sync-script-generator', version: '1.0.0' } },
	});
	const stub = stubInstall(async () => ({ status: 'updated' }));
	try {
		const result = await blocked.service.updateAuxPluginByKey('sync-script-generator');
		assert.equal(result.status, 'skipped');
		assert.deepEqual(stub.calls, []);
	} finally {
		stub.restore();
	}

	const allowed = createService(
		{
			updateIDs: {
				...SETTINGS.updateIDs,
				iotoSettingPlugin: {
					baseID: 'appSetting',
					tableID: 'tblSetting',
					viewID: 'viwZvtQy1GDWu00sA',
				},
			},
		},
		{
			manifests: { 'sync-script-generator': { id: 'sync-script-generator', version: '1.0.0' } },
		},
	);
	const stub2 = stubInstall(async () => ({ status: 'updated' }));
	try {
		const result = await allowed.service.updateAuxPluginByKey('sync-script-generator');
		assert.equal(result.status, 'updated');
		assert.equal(stub2.calls.length, 1);
	} finally {
		stub2.restore();
	}
});

test('一键更新完整 IOTO：框架 4 表 → Setting 表 → 11 个插件 → 自身，只重载一次', async () => {
	const { service, commands, reloads } = createService({}, {
		manifests: ALL_MANIFESTS,
	});
	service.registerCommands();
	// 单测没有 DOM：进度面板整体关掉（与既有 askMyIotoSubFolderMode 同一注入方式）
	service.createProgressPanel = () => null;

	const tables = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		tables.push(tableConfig.viewID);
	};

	const stub = stubInstall(async () => ({ status: 'up-to-date' }));
	try {
		await commands.find((command) => command.id === 'full-update-ioto').callback();
	} finally {
		stub.restore();
	}

	assert.deepEqual(tables, ['viwCore', 'viwHelp', 'viwMy', 'viwCss', 'viwSetting']);
	assert.equal(
		stub.calls.length,
		11,
		"10 个辅助插件（SSG 不在白名单，已跳过）+ 自身",
	);
	assert.equal(
		stub.calls.at(-1).url,
		'https://gitee.com/johnnylearns/ioto-update',
		'自身必须最后执行',
	);
	assert.deepEqual(reloads, ['app:reload']);
});

test('一键更新完整 IOTO 在框架失败时仍跑完辅助插件，且不启用 Setting 插件', async () => {
	const { service, commands, app, enabled } = createService({}, {
		manifests: ALL_MANIFESTS,
	});
	service.registerCommands();
	service.createProgressPanel = () => null;

	service.executeNocoDBCommand = async (tableConfig) => {
		if (tableConfig.viewID !== 'viwSetting') {
			throw new Error('framework down');
		}
	};

	const stub = stubInstall(async () => ({ status: 'up-to-date' }));
	try {
		await commands.find((command) => command.id === 'full-update-ioto').callback();
	} finally {
		stub.restore();
	}

	assert.equal(stub.calls.length, 11, "框架失败不影响阶段 3 / 4（SSG 仍按白名单跳过）");
	assert.deepEqual(app.plugins.enabledPlugins, new Set(), '失败时不该启用 ioto-settings');
	assert.deepEqual(enabled, []);
});

// ---------------------------------------------------------------------------
// quiet 门控：全量链路静音，原有更新方式不受影响（Plan-20261026-102044）
// ---------------------------------------------------------------------------

/** 单测没有 DOM：用事件收集器替掉真实面板，同时能读到阶段结果。 */
function stubPanel(service) {
	const events = [];
	service.createProgressPanel = () => ({
		handle: (event) => events.push(event),
		requestReload: () => {},
		destroy: () => {},
	});
	return events;
}

test('一键更新完整 IOTO 全程静音：跳过提示与逐表提示都不再弹出', async () => {
	const { service, commands } = createService(
		{ skipMyIotoInAllUpdates: true, myIotoDeployed: true },
		{ manifests: ALL_MANIFESTS },
	);
	service.registerCommands();
	const events = stubPanel(service);
	service.executeNocoDBCommand = async () => {};

	const stub = stubInstall(async () => ({ status: 'up-to-date' }));
	notices.length = 0;
	try {
		await commands.find((command) => command.id === 'full-update-ioto').callback();
	} finally {
		stub.restore();
	}

	assert.deepEqual(notices, [], `全量链路不该有任何 Notice，实际: ${notices.join(' | ')}`);

	// 静音后「已跳过」只能靠面板：框架阶段结果里要补一行 skipped
	const frameworkEnd = events.find(
		(event) => event.type === 'stage-end' && event.stage === 'framework',
	);
	assert.deepEqual(
		frameworkEnd.result.items.map((item) => [item.label, item.status]),
		[
			['Update Core Files', 'updated'],
			['Update Help Docs', 'updated'],
			['Update MYIOTO Templates', 'skipped'],
			['Update CSS Snippets', 'updated'],
		],
		'跳过的 MyIOTO 要按原顺序补一行 skipped',
	);
});

test('一键更新完整 IOTO 失败也静音：失败原因只走阶段结果', async () => {
	const { service, commands } = createService({}, {
		manifests: ALL_MANIFESTS,
	});
	service.registerCommands();
	const events = stubPanel(service);
	service.executeNocoDBCommand = async () => {
		throw new Error('boom');
	};

	const stub = stubInstall(async () => ({ status: 'up-to-date' }));
	notices.length = 0;
	try {
		await commands.find((command) => command.id === 'full-update-ioto').callback();
	} finally {
		stub.restore();
	}

	assert.deepEqual(notices, [], `失败也不该弹 Notice，实际: ${notices.join(' | ')}`);
	const frameworkEnd = events.find(
		(event) => event.type === 'stage-end' && event.stage === 'framework',
	);
	assert.equal(frameworkEnd.result.status, 'failed');
	assert.ok(
		frameworkEnd.result.items.every(
			(item) => item.status === 'failed' && item.detail === 'boom',
		),
		'失败原因要随阶段结果交给面板',
	);
});

test('一键部署全程静音 + 事件齐全（与完整更新同款面板）', async () => {
	const {
		service,
		commands,
		reloads,
		reloadRequests,
		panelEvents,
		installedKeys,
		installedOptions,
	} = createService();
	service.registerCommands();
	service.executeNocoDBCommand = async (...args) => {
		// 触发文件级进度回调，验证 framework-progress 也进面板
		const options = args[args.length - 1];
		options?.onProgress?.(1, 1);
	};

	notices.length = 0;
	await commands.find((command) => command.id === 'run-all-updates').callback();

	assert.deepEqual(notices, [], `部署不该有任何 Notice，实际: ${notices.join(' | ')}`);
	assert.deepEqual(installedKeys, ['ioto-tasks-center', 'ioto-dashboard']);
	assert.deepEqual(
		installedOptions,
		[{ silent: true }, { silent: true }],
		'部署安装只静音，不能传 autoReload:false（新装插件需要它来启用）',
	);
	assert.deepEqual(
		panelEvents.map((event) => event.type),
		[
			'stage-start',
			...Array(5).fill('framework-progress'),
			'stage-end',
			'stage-start',
			'plugin-progress',
			'plugin-progress',
			'stage-end',
			'finished',
		],
	);
	assert.deepEqual(
		panelEvents
			.filter((event) => event.type === 'stage-end')
			.map((event) => event.done),
		[1, 3],
	);
	const finished = panelEvents.find((event) => event.type === 'finished');
	assert.equal(finished.summary.total, 3);
	assert.equal(finished.summary.done, 3);
	assert.equal(reloadRequests.length, 1, '面板只请求一次重载');
	assert.deepEqual(reloads, ['app:reload']);
});

test('一键部署面板标题为「部署进度」，完整更新仍用默认标题', async () => {
	const { service, commands } = createService({}, { manifests: ALL_MANIFESTS });
	service.registerCommands();
	const titles = [];
	const baseCreate = service.createProgressPanel;
	service.createProgressPanel = (title) => {
		titles.push(title);
		return baseCreate(title);
	};
	service.executeNocoDBCommand = async () => {};

	const stub = stubInstall(async () => ({ status: 'up-to-date' }));
	try {
		await commands.find((command) => command.id === 'run-all-updates').callback();
		await commands.find((command) => command.id === 'full-update-ioto').callback();
	} finally {
		stub.restore();
	}
	assert.deepEqual(titles, ['Deploy Progress', undefined]);
});

test('必备插件安装失败不中断，失败原因进面板明细且不再 console.error', async () => {
	const { service, commands, panelEvents, reloadRequests } = createService();
	service.registerCommands();
	service.executeNocoDBCommand = async () => {};
	service.installPluginByKey = async (key) => {
		if (key === 'ioto-tasks-center') {
			return { status: 'failed', error: 'boom' };
		}
		return { status: 'up-to-date', pluginId: key };
	};

	const originalError = console.error;
	const errors = [];
	console.error = (...args) => errors.push(args);
	try {
		await commands.find((command) => command.id === 'run-all-updates').callback();
	} finally {
		console.error = originalError;
	}

	const pluginEnd = panelEvents.find(
		(event) => event.type === 'stage-end' && event.stage === 'essential-plugins',
	);
	assert.deepEqual(pluginEnd.result.items, [
		{ label: 'IOTO Tasks Center', status: 'failed', detail: 'boom' },
		{ label: 'IOTO Dashboard', status: 'up-to-date', detail: undefined },
	], '第二个插件仍被尝试，失败原因进明细');
	assert.deepEqual(errors, [], '失败由面板呈现，不再 console.error');
	assert.equal(reloadRequests.length, 1, '插件失败不影响末尾重载');
});

test('框架同步失败时不请求重载，但 finished 事件与 1/3 进度仍发出', async () => {
	const { service, commands, enabled, reloadRequests, panelEvents } =
		createService();
	service.registerCommands();
	service.executeNocoDBCommand = async () => {
		throw new Error('framework down');
	};

	await commands.find((command) => command.id === 'run-all-updates').callback();

	assert.equal(reloadRequests.length, 0, '框架失败让用户看面板明细自行处理');
	assert.deepEqual(enabled, []);
	assert.deepEqual(
		panelEvents
			.filter((event) => event.type === 'stage-end')
			.map((event) => event.done),
		[1, 3],
	);
	const finished = panelEvents.find((event) => event.type === 'finished');
	assert.ok(finished, 'finished 事件仍发出');
	assert.ok(finished.summary.failed >= 5, '框架失败计入 summary.failed');
});
