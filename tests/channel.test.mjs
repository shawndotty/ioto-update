/**
 * `src/services/channel.ts` —— 预发布通道判定。
 *
 * 口径是「两个 viewID 精确匹配且取与」，只命中一个必须判否，
 * 否则会让单个 ID 命中用户被错误升级到预发布。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isPreReleaseChannel,
	PRERELEASE_VIEW_IDS,
} from '../src/services/channel.ts';

function settings(coreViewID, fullViewID) {
	return {
		updateIDs: {
			iotoCore: { viewID: coreViewID },
			myIotoFull: { viewID: fullViewID },
		},
	};
}

test('两个 viewID 同时命中时为预发布通道', () => {
	assert.equal(
		isPreReleaseChannel(
			settings(PRERELEASE_VIEW_IDS.iotoCore, PRERELEASE_VIEW_IDS.myIotoFull),
		),
		true,
	);
});

test('只命中一个 viewID 不算预发布通道', () => {
	assert.equal(
		isPreReleaseChannel(settings(PRERELEASE_VIEW_IDS.iotoCore, 'viwOther')),
		false,
	);
	assert.equal(
		isPreReleaseChannel(settings('viwOther', PRERELEASE_VIEW_IDS.myIotoFull)),
		false,
	);
});

test('两个都不是预发布 viewID 时为正式通道', () => {
	assert.equal(isPreReleaseChannel(settings('viwCore', 'viwMy')), false);
});

test('缺字段 / 空设置不误判为预发布通道', () => {
	assert.equal(isPreReleaseChannel({}), false);
	assert.equal(isPreReleaseChannel({ updateIDs: {} }), false);
	assert.equal(
		isPreReleaseChannel({ updateIDs: { iotoCore: {} } }),
		false,
	);
});
