/**
 * `src/utils/index.ts` —— 纯函数层（无 App、无网络、无 DOM）。
 *
 * 这一层是插件的公共判据：API Key / 邮箱校验决定命令是否注册，
 * 版本比较决定「检查更新」按钮显示「已是最新 / 可更新 / 开发版」，
 * Airtable URL 解析决定个人同步表能不能被识别；字段名映射决定从 Airtable
 * 取哪几列。把它们钉在单测里，比在真机里点按钮划算得多。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { moment } from './stubs/obsidian.mjs';
import { TFolder, TFile } from './stubs/obsidian.mjs';
import {
	Utils,
	get_tfiles_from_folder,
	resolve_tfolder,
} from '../src/utils/index.ts';

/** 合法的 Airtable Personal Access Token 形状：`pat` 开头、足够长、含 `.`。 */
const VALID_API_KEY = `pat${'a'.repeat(78)}.${'b'.repeat(20)}`;

test('isValidApiKey 接受 82 位以上、含 pat 与点号的 token', () => {
	assert.equal(Utils.isValidApiKey(VALID_API_KEY), true);
	assert.equal(Utils.isValidApiKey(`pat${'a'.repeat(78)}.`), true, '恰好 82 位');
});

test('isValidApiKey 拒绝空值、过短、缺 pat、缺点号', () => {
	assert.equal(Utils.isValidApiKey(''), false);
	assert.equal(Utils.isValidApiKey('pat.'), false, '长度不足');
	assert.equal(
		Utils.isValidApiKey(`abc${'a'.repeat(80)}.${'b'.repeat(10)}`),
		false,
		'不以 pat 开头',
	);
	assert.equal(
		Utils.isValidApiKey(`pat${'a'.repeat(90)}`),
		false,
		'没有点号',
	);
});

test('isValidApiKey 在 81/82 位边界上分界', () => {
	const at = (length) => `pat${'a'.repeat(length - 4)}.`;
	assert.equal(Utils.isValidApiKey(at(81)), false);
	assert.equal(Utils.isValidApiKey(at(82)), true);
});

test('isValidEmail 接受常规邮箱并拒绝缺 @ / 缺点号 / 过短的输入', () => {
	assert.equal(Utils.isValidEmail('user@example.com'), true);
	assert.equal(Utils.isValidEmail('first.last+tag@sub.example.co'), true);
	assert.equal(Utils.isValidEmail(''), false);
	assert.equal(Utils.isValidEmail('userexample.com'), false, '缺 @');
	assert.equal(Utils.isValidEmail('user@examplecom'), false, '@ 后无点号');
	assert.equal(Utils.isValidEmail('a@b.c'), false, '长度不足 10');
	assert.equal(Utils.isValidEmail('user name@example.com'), false, '含空格');
});

test('extractAirtableIds 解析带 view 的完整 URL', () => {
	assert.deepEqual(
		Utils.extractAirtableIds(
			'https://airtable.com/appXXXXXXXXXXXXXX/tblYYYYYYYYYYYYYY/viwZZZZZZZZZZZZZZ',
		),
		{
			baseId: 'appXXXXXXXXXXXXXX',
			tableId: 'tblYYYYYYYYYYYYYY',
			viewId: 'viwZZZZZZZZZZZZZZ',
		},
	);
});

test('extractAirtableIds 在无 view / http 协议时也能解析', () => {
	assert.deepEqual(Utils.extractAirtableIds('http://airtable.com/appAAA/tblBBB'), {
		baseId: 'appAAA',
		tableId: 'tblBBB',
		viewId: '',
	});
	assert.equal(
		Utils.extractAirtableIds(
			'https://airtable.com/appAAA/tblBBB/viwCCC?blocks=hide',
		).viewId,
		'viwCCC',
	);
});

test('extractAirtableIds 对非 Airtable 链接返回 null', () => {
	assert.equal(Utils.extractAirtableIds(''), null);
	assert.equal(Utils.extractAirtableIds('https://example.com/appAAA/tblBBB'), null);
	assert.equal(Utils.extractAirtableIds('https://airtable.com/appAAA'), null);
});

test('compareVersions 按数字段比较而不是字典序', () => {
	assert.equal(Utils.compareVersions('2.6.2', '2.6.10'), -1);
	assert.equal(Utils.compareVersions('2.6.10', '2.6.2'), 1);
	assert.equal(Utils.compareVersions('2.6.2', '2.6.2'), 0);
});

test('compareVersions 允许段数不同，缺失段按 0 处理', () => {
	assert.equal(Utils.compareVersions('2.6', '2.6.0'), 0);
	assert.equal(Utils.compareVersions('2.6.1', '2.6'), 1);
	assert.equal(Utils.compareVersions('2', '2.0.1'), -1);
	assert.equal(Utils.compareVersions('10.0.0', '9.9.9'), 1);
});

test('buildFieldNames 强制默认字段时忽略语言', () => {
	assert.deepEqual(Utils.buildFieldNames(true, 'zh-tw'), {
		title: 'Title',
		subFolder: 'SubFolder',
		content: 'MD',
	});
});

test('buildFieldNames 在 ob 模式下跟随 moment.locale()', () => {
	const original = moment.locale();
	try {
		moment.locale('zh-cn');
		assert.deepEqual(Utils.buildFieldNames(false, 'ob'), {
			title: 'Title',
			subFolder: 'SubFolder',
			content: 'MD',
		});

		moment.locale('zh-tw');
		assert.deepEqual(Utils.buildFieldNames(false, 'ob'), {
			title: 'TitleTW',
			subFolder: 'SubFolderTW',
			content: 'MDTW',
		});

		moment.locale('en');
		assert.deepEqual(Utils.buildFieldNames(false, 'ob'), {
			title: 'TitleEN',
			subFolder: 'SubFolderEN',
			content: 'MDEN',
		});
	} finally {
		moment.locale(original);
	}
});

test('buildFieldNames 在显式语言下以设置为准，未知语言回落 en', () => {
	moment.locale('zh-cn');
	assert.deepEqual(Utils.buildFieldNames(false, 'zh-tw'), {
		title: 'TitleTW',
		subFolder: 'SubFolderTW',
		content: 'MDTW',
	});
	assert.deepEqual(Utils.buildFieldNames(false, 'en'), {
		title: 'TitleEN',
		subFolder: 'SubFolderEN',
		content: 'MDEN',
	});
	assert.deepEqual(Utils.buildFieldNames(false, 'fr'), {
		title: 'TitleEN',
		subFolder: 'SubFolderEN',
		content: 'MDEN',
	});
});

test('hasMyIotoContent 只认 MyIOTO 目录，兼容历史命名且不误匹配前缀', () => {
	const root = '0-辅助/IOTO/Templates/Templater';
	assert.equal(Utils.hasMyIotoContent([], '0-辅助/IOTO'), false);
	assert.equal(
		Utils.hasMyIotoContent([`${root}/MyIOTO/a.md`], '0-辅助/IOTO'),
		true,
	);
	assert.equal(
		Utils.hasMyIotoContent([`${root}/MyIOTO-1-1-1/a.md`], '0-辅助/IOTO'),
		true,
	);
	assert.equal(
		Utils.hasMyIotoContent([`${root}/MyIOTO-10-12-3/a.md`], '0-辅助/IOTO'),
		true,
		'两位数版本段也要认',
	);
	assert.equal(
		Utils.hasMyIotoContent([`${root}/MyIOTO-Beta/a.md`], '0-辅助/IOTO'),
		false,
		'非数字版本段不算',
	);
	assert.equal(
		Utils.hasMyIotoContent([`${root}/MyIOTOX/a.md`], '0-辅助/IOTO'),
		false,
		'同名前缀不算',
	);
	assert.equal(
		Utils.hasMyIotoContent(
			['0-辅助/IOTO2/Templates/Templater/MyIOTO/a.md'],
			'0-辅助/IOTO',
		),
		false,
		'frameworkPath 前缀误匹配',
	);
	assert.equal(
		Utils.hasMyIotoContent([`${root}/Other/MyIOTO/a.md`], '0-辅助/IOTO'),
		false,
		'深层同名目录不算',
	);
});

/** 造一个只提供路径索引的最小 vault。 */
function createVault(entries) {
	return {
		getAbstractFileByPath(path) {
			return entries.find((entry) => entry.path === path) ?? null;
		},
	};
}

test('resolve_tfolder 能取到文件夹，路径会先规范化', () => {
	const folder = new TFolder('IOTO');
	const app = { vault: createVault([folder]) };
	assert.equal(resolve_tfolder(app, 'IOTO'), folder);
});

test('resolve_tfolder 在路径不存在 / 目标是文件时抛错', () => {
	const file = new TFile('IOTO/note.md');
	const app = { vault: createVault([file]) };
	assert.throws(() => resolve_tfolder(app, 'Missing'), /doesn't exist/);
	assert.throws(() => resolve_tfolder(app, 'IOTO/note.md'), /not a folder/);
});

test('get_tfiles_from_folder 递归收集文件并按路径排序', () => {
	const folder = new TFolder('IOTO');
	const nested = new TFolder('IOTO/nested');
	folder.children = [new TFile('IOTO/b.md'), nested, new TFile('IOTO/a.md')];
	nested.children = [new TFile('IOTO/nested/c.md')];

	const app = { vault: createVault([folder]) };
	assert.deepEqual(
		get_tfiles_from_folder(app, 'IOTO').map((file) => file.path),
		['IOTO/a.md', 'IOTO/b.md', 'IOTO/nested/c.md'],
	);
});
