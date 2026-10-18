/**
 * `src/services/db-syncer/nocodb-sync.ts` —— Airtable(NocoDB 兼容) 拉取与落盘。
 *
 * 这部分负责把多语言列（TitleEN / MDTW …）折叠成统一的 Title/MD/SubFolder，
 * 并决定「新建 / 修改 / 直接写配置目录」。文件名清洗与 MyIOTO 子目录归一化
 * 一旦回归，会把用户已有的模板目录写成新目录，属于高风险区，所以逐条钉住。
 *
 * 网络用 `globalThis.fetch` 桩替换；Vault 用内存 Map 模拟。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { NocoDB } from '../src/services/db-syncer/nocodb.ts';
import { NocoDBSync } from '../src/services/db-syncer/nocodb-sync.ts';
import { notices } from './stubs/obsidian.mjs';

/** 造一个只存在内存里的最小 Vault。 */
function createVault({ files = {}, folders = [] } = {}) {
	const fileMap = new Map(Object.entries(files));
	const folderSet = new Set(folders);
	const writes = [];
	const modified = [];
	const created = [];
	return {
		files: fileMap,
		folders: folderSet,
		writes,
		modified,
		created,
		async exists(path) {
			return fileMap.has(path) || folderSet.has(path);
		},
		async createFolder(path) {
			folderSet.add(path);
		},
		async create(path, content) {
			created.push(path);
			fileMap.set(path, content);
		},
		getFileByPath(path) {
			return fileMap.has(path) ? { path } : null;
		},
		async modify(file, content) {
			modified.push(file.path);
			fileMap.set(file.path, content);
		},
		adapter: {
			async write(path, content) {
				writes.push({ path, content });
				fileMap.set(path, content);
			},
		},
	};
}

function createSync({ table, appOverrides = {}, fields } = {}) {
	const nocodb = new NocoDB({
		apiKey: 'airtable-token',
		tables: table ? [table] : [],
		iotoUpdate: true,
		syncSettings: { recordFieldsNames: fields },
	});
	const vault = createVault(appOverrides);
	const app = { vault };
	return { sync: new NocoDBSync(nocodb, app), vault };
}

/** 用一次性的 fetch 桩替换全局 fetch，返回调用记录。 */
function stubFetch(responses) {
	const calls = [];
	const queue = [...responses];
	globalThis.fetch = async (url, options) => {
		calls.push({ url, options });
		const response = queue.shift() ?? { ok: true, status: 200, json: async () => ({ records: [] }) };
		if (response instanceof Error) throw response;
		return response;
	};
	return calls;
}

const TABLE = {
	baseID: 'appBase',
	tableID: 'tblTable',
	viewID: 'viwView',
	targetFolderPath: 'IOTO',
};

test('convertToValidFileName 逐字符替换非法字符并保留中文', () => {
	const { sync } = createSync();
	// 每个非法字符各替换成一个 `-`（不合并连续短横线），因此全角括号两侧会留下双横线
	assert.equal(sync.convertToValidFileName('a/b\\c:d"e\'f(g)h'), 'a-b-c-d-e-f-g-h');
	assert.equal(sync.convertToValidFileName('a（b）'), 'a-b-');
	assert.equal(sync.convertToValidFileName('笔记.v1*'), '笔记-v1-');
	assert.equal(sync.convertToValidFileName('  padded  '), 'padded');
});

test('fetchRecordsFromSource 用本地化列名请求，并折叠成 Title/MD/SubFolder', async () => {
	const { sync } = createSync({
		table: TABLE,
		fields: { title: 'TitleEN', content: 'MDEN', subFolder: 'SubFolderEN' },
	});
	const calls = stubFetch([
		{
			ok: true,
			status: 200,
			json: async () => ({
				records: [
					{
						fields: {
							TitleEN: 'Hello',
							SubFolderEN: 'docs',
							MDEN: '# body',
							Extension: 'md',
							UpdatedIn: 7,
						},
					},
				],
			}),
		},
	]);

	const records = await sync.fetchRecordsFromSource(TABLE);

	assert.equal(calls.length, 1);
	assert.ok(calls[0].url.includes('view=viwView'));
	for (const field of ['TitleEN', 'MDEN', 'SubFolderEN', 'Extension']) {
		assert.ok(
			calls[0].url.includes(`fields%5B%5D=${field}`),
			`缺少字段 ${field}: ${calls[0].url}`,
		);
	}
	assert.equal(calls[0].options.headers.Authorization, 'Bearer airtable-token');
	assert.deepEqual(records[0].fields, {
		Title: 'Hello',
		SubFolder: 'docs',
		MD: '# body',
		Extension: 'md',
		UpdatedIn: 7,
	});
});

test('fetchRecordsFromSource 在空结果时返回空数组', async () => {
	const { sync } = createSync({ table: TABLE });
	stubFetch([{ ok: true, status: 200, json: async () => ({ records: [] }) }]);
	assert.deepEqual(await sync.fetchRecordsFromSource(TABLE), []);
});

test('getAllRecordsFromTable 按 offset 分页累计', async () => {
	const { sync } = createSync({ table: TABLE });
	const calls = stubFetch([
		{ ok: true, status: 200, json: async () => ({ records: [{ id: 1 }], offset: 'next' }) },
		{ ok: true, status: 200, json: async () => ({ records: [{ id: 2 }] }) },
	]);

	const records = await sync.getAllRecordsFromTable('https://api.airtable.com/v0/app/tbl?');
	assert.deepEqual(records, [{ id: 1 }, { id: 2 }]);
	assert.equal(calls.length, 2);
	assert.ok(calls[1].url.endsWith('next'));
});

test('getAllRecordsFromTable 遇 401 时提示 token 失效并返回空数组', async () => {
	const { sync } = createSync({ table: TABLE });
	stubFetch([{ ok: false, status: 401, json: async () => ({}) }]);

	notices.length = 0;
	assert.deepEqual(await sync.getAllRecordsFromTable('https://api.airtable.com/v0/app/tbl?'), []);
	assert.ok(notices.includes('API Token Invalid'));
});

test('createOrUpdateNotesInOBFromSourceTable 新建文件并清洗文件名', async () => {
	const { sync, vault } = createSync({ table: { ...TABLE, intialSetup: true } });
	stubFetch([
		{
			ok: true,
			status: 200,
			json: async () => ({
				records: [
					{
						fields: {
							Title: 'New:File',
							SubFolder: 'docs/MyIOTO-3-1-2',
							MD: 'body',
							Extension: 'md',
						},
					},
				],
			}),
		},
	]);

	await sync.createOrUpdateNotesInOBFromSourceTable({ ...TABLE, intialSetup: true });

	assert.deepEqual(vault.created, ['IOTO/docs/MyIOTO/New-File.md']);
	assert.equal(vault.files.get('IOTO/docs/MyIOTO/New-File.md'), 'body');
});

test('intialSetup 归一化支持多位数版本段，且不误伤同名前缀目录', async () => {
	const { sync, vault } = createSync({ table: { ...TABLE, intialSetup: true } });
	stubFetch([
		{
			ok: true,
			status: 200,
			json: async () => ({
				records: [
					{ fields: { Title: 'Big', SubFolder: 'docs/MyIOTO-10-12-3', MD: 'a' } },
					{ fields: { Title: 'Small', SubFolder: 'docs/MyIOTO-1-10-1', MD: 'b' } },
					{ fields: { Title: 'Other', SubFolder: 'docs/MyIOTOX-1-2-3', MD: 'c' } },
				],
			}),
		},
	]);

	await sync.createOrUpdateNotesInOBFromSourceTable({ ...TABLE, intialSetup: true });

	assert.deepEqual(vault.created.sort(), [
		'IOTO/docs/MyIOTO/Big.md',
		'IOTO/docs/MyIOTO/Small.md',
		'IOTO/docs/MyIOTOX-1-2-3/Other.md',
	]);
});

test('createOrUpdateNotesInOBFromSourceTable 对已存在文件走 modify', async () => {
	const { sync, vault } = createSync({
		table: TABLE,
		appOverrides: { files: { 'IOTO/Existing.md': 'old' } },
	});
	stubFetch([
		{
			ok: true,
			status: 200,
			json: async () => ({
				records: [{ fields: { Title: 'Existing', MD: 'new' } }],
			}),
		},
	]);

	await sync.createOrUpdateNotesInOBFromSourceTable(TABLE);

	assert.deepEqual(vault.modified, ['IOTO/Existing.md']);
	assert.equal(vault.files.get('IOTO/Existing.md'), 'new');
	assert.equal(vault.created.length, 0, '已存在时不应再 create');
});

test('createOrUpdateNotesInOBFromSourceTable 对配置目录内的文件直接走 adapter.write', async () => {
	const { sync, vault } = createSync({
		table: { ...TABLE, targetFolderPath: '.obsidian' },
		appOverrides: { files: { '.obsidian/snippets/Existing.css': 'old' } },
	});
	stubFetch([
		{
			ok: true,
			status: 200,
			json: async () => ({
				records: [
					{
						fields: {
							Title: 'Existing',
							SubFolder: 'snippets',
							MD: 'new css',
							Extension: 'css',
						},
					},
				],
			}),
		},
	]);

	await sync.createOrUpdateNotesInOBFromSourceTable({
		...TABLE,
		targetFolderPath: '.obsidian',
	});

	assert.deepEqual(vault.writes, [
		{ path: '.obsidian/snippets/Existing.css', content: 'new css' },
	]);
	assert.equal(vault.modified.length, 0, '配置目录不走 vault.modify');
});

test('createOrUpdateNotesInOBFromSourceTable 分批处理并在结束后提示完成', async () => {
	const { sync } = createSync({ table: TABLE });
	const records = Array.from({ length: 12 }, (_, index) => ({
		fields: { Title: `Note${index}`, MD: String(index) },
	}));
	stubFetch([{ ok: true, status: 200, json: async () => ({ records }) }]);

	notices.length = 0;
	await sync.createOrUpdateNotesInOBFromSourceTable(TABLE);

	assert.ok(notices.includes('There are 2 files needed to be processed.'));
	assert.ok(notices.includes('All Finished.'));
});
