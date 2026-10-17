/**
 * `src/services/api-service.ts` —— Airtable 授权查询。
 *
 * 邮箱 / API Key 校验通过后，命令才会被注册；这一步拿到的是用户可用的
 * updateIDs 与 userChecked。三条分支（有记录 / 无记录 / 请求失败）都覆盖，
 * 避免「邮箱打错一个字 → 全部命令消失且无提示」这类问题回归。
 *
 * 该模块用的是运行时全局 `requestUrl`（`declare function`），桩在 stubs 里一并挂到 globalThis。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiService } from '../src/services/api-service.ts';
import { DEFAULT_UPDATE_IDS } from '../src/constants.ts';
import { resetRequestUrlHandler, setRequestUrlHandler } from './stubs/obsidian.mjs';

const USER_EMAIL = 'user@example.com';

function createSettings(overrides = {}) {
	return {
		userEmail: USER_EMAIL,
		updateAPIKey: 'pat-token',
		...overrides,
	};
}

test.afterEach(() => {
	resetRequestUrlHandler();
});

test('getUpdateIDs 命中记录时解析 updateIDs 并标记 userChecked', async () => {
	const updateIDs = {
		iotoCore: { baseID: 'appCore', tableID: 'tblCore', viewID: 'viwCore' },
	};
	let captured;
	setRequestUrlHandler(async (options) => {
		captured = options;
		return {
			json: {
				records: [
					{
						fields: {
							IOTOUpdateIDs: {
								first: () => JSON.stringify(updateIDs),
							},
						},
					},
				],
			},
		};
	});

	const result = await new ApiService(createSettings()).getUpdateIDs();

	assert.deepEqual(result, { updateIDs, userChecked: true });
	assert.equal(captured.method, 'GET');
	assert.ok(captured.url.includes('Email'), captured.url);
	assert.ok(captured.url.includes(USER_EMAIL), '邮箱应出现在 filterByFormula 里');
	assert.ok(captured.headers.Authorization.startsWith('Bearer '));
});

test('getUpdateIDs 会先 trim 邮箱再拼查询条件', async () => {
	let captured;
	setRequestUrlHandler(async (options) => {
		captured = options;
		return { json: { records: [] } };
	});

	await new ApiService(
		createSettings({ userEmail: `  ${USER_EMAIL}  ` }),
	).getUpdateIDs();

	assert.ok(captured.url.includes(`'${USER_EMAIL}'`), captured.url);
});

test('getUpdateIDs 无记录时回落默认 updateIDs 且 userChecked=false', async () => {
	setRequestUrlHandler(async () => ({ json: { records: [] } }));

	const result = await new ApiService(createSettings()).getUpdateIDs();

	assert.equal(result.userChecked, false);
	assert.equal(result.updateIDs, DEFAULT_UPDATE_IDS);
});

test('getUpdateIDs 请求失败时抛出可读错误', async () => {
	setRequestUrlHandler(async () => {
		throw new Error('network error');
	});

	await assert.rejects(
		() => new ApiService(createSettings()).getUpdateIDs(),
		/Failed to get update IDs from Airtable\./,
	);
});

test('checkApiKey 在 webhook 请求失败时抛出可读错误', async () => {
	setRequestUrlHandler(async () => {
		throw new Error('network error');
	});

	await assert.rejects(
		() => new ApiService(createSettings()).checkApiKey(),
		/Failed to check API key\./,
	);
});
