/**
 * `src/services/command-service.ts` —— 命令注册闸门与一键部署编排。
 *
 * 两个关键语义：
 * 1. 未授权（userChecked / API Key / 邮箱任一不满足）时**一条命令都不注册**，
 *    命令面板里不会留下点了就报错的死命令；
 * 2. 「一键部署」只跑 isPartOfAllUpdates 的 5 个数据源，并只给 MyIOTO 打 intialSetup。
 *
 * 这里只替换 NocoDB 同步与网络边界（requestUrl 桩默认抛错），断言的是编排本身。
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
			manifests: {},
			enabledPlugins: new Set(),
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
	const plugin = {
		app,
		settings: { ...settings },
		saveSettings: async () => {},
	};
	const commands = [];
	const service = new CommandService(
		app,
		plugin,
		(command) => commands.push(command),
		settings,
		{ getPluginSetting: () => null, setTemplaterSetting: async () => {} },
		{ getUpdateIDs: async () => ({ updateIDs: {}, userChecked: true }) },
	);
	return { service, commands, app, reloads, enabled, plugin };
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
	const { service, commands, enabled, reloads } = createService();
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
});

test('开启跳过设置后，一键部署只跑其余 4 个数据源并给出跳过提示', async () => {
	const { service, commands, enabled, reloads } =
		createService({ skipMyIotoInAllUpdates: true });
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
	assert.ok(
		notices.includes('MYIOTO update skipped per settings.'),
		`缺少跳过提示，实际: ${notices.join(' | ')}`,
	);
	assert.deepEqual(enabled, ['ioto-settings']);
	assert.deepEqual(reloads, ['app:reload']);
});

test('开启跳过设置后，单独执行「更新MYIOTO模板」仍然更新 MyIOTO', async () => {
	const { service, commands } = createService({
		skipMyIotoInAllUpdates: true,
	});
	service.registerCommands();

	const calls = [];
	service.executeNocoDBCommand = async (tableConfig) => {
		calls.push(tableConfig);
	};

	await commands.find((command) => command.id === 'get-myioto').callback();

	assert.deepEqual(calls.map((config) => config.viewID), ['viwMy']);
});

test('改设置后下一次一键部署立即生效，无需重载插件', async () => {
	const { service, commands, plugin } = createService();
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

test('一键部署单个数据源失败时给出失败提示且继续跑完其余任务', async () => {
	const { service, commands } = createService();
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
	assert.ok(
		notices.includes('Update CSS Snippets failed: boom'),
		`缺少失败提示，实际: ${notices.join(' | ')}`,
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
		githubRun.service.registerCommands();
		await githubRun.commands
			.find((command) => command.id === 'install-ioto-dashboard-from-github')
			.callback();

		const giteeRun = createService({ pluginDownloadSource: 'gitee' });
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
