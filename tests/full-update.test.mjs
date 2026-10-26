/**
 * `src/services/full-update-service.ts` —— 一键全量更新的编排器。
 *
 * 编排器不碰网络、不碰 Vault，全部依赖注入，所以这里断言的是**调度语义**：
 * 阶段顺序、失败隔离、进度单位数、重载条件。
 * 安装判定本身在 `gitee-service.test.mjs` / `github-service.test.mjs` 里钉。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runFullUpdate } from '../src/services/full-update-service.ts';
import { IOTO_PLUGINS } from '../src/services/plugin-registry.ts';

function stage(name, status = 'done', items = []) {
	return { stage: name, status, items };
}

/**
 * 默认全绿：框架 + Setting 插件各 1 单位，辅助插件全部「已是最新」，自身「已是最新」。
 * 任何用例只覆盖自己关心的那一段。
 */
function createDeps(overrides = {}) {
	const calls = [];
	const events = [];
	const deps = {
		auxPluginKeys: IOTO_PLUGINS.map((entry) => entry.key),
		async runFrameworkStage(onProgress) {
			calls.push('framework');
			onProgress?.(0, 1);
			onProgress?.(1, 1);
			return stage('framework', 'done', [
				{ label: 'core', status: 'updated' },
			]);
		},
		async updateSettingPlugin(context) {
			calls.push(`setting:${context.frameworkFailed}`);
			return stage('setting-plugin', 'done', [
				{ label: 'setting', status: 'updated' },
			]);
		},
		async updateAuxPlugin(key) {
			calls.push(`aux:${key}`);
			return { status: 'up-to-date', pluginId: key };
		},
		async updateSelf() {
			calls.push('self');
			return { status: 'up-to-date', pluginId: 'ioto-update' };
		},
		reloadApp() {
			calls.push('reload');
		},
		onEvent(event) {
			events.push(event);
		},
		...overrides,
	};
	return { deps, calls, events };
}

test('阶段按「框架 → Setting 插件 → 11 个辅助插件 → 自身」串行，总单位 14', async () => {
	const { deps, calls } = createDeps();
	const summary = await runFullUpdate(deps);

	assert.equal(summary.total, 14, '1 + 1 + 11 + 1');
	assert.equal(summary.done, 14);
	assert.equal(summary.stages.map((item) => item.stage).join(','), 'framework,setting-plugin,aux-plugins,self');

	assert.equal(calls[0], 'framework');
	assert.equal(calls[1], 'setting:false');
	assert.equal(calls.slice(2, 13).join(','), IOTO_PLUGINS.map((entry) => `aux:${entry.key}`).join(','));
	assert.equal(calls[13], 'self');
});

test('全部「已是最新」时不重载，也不标成写过文件', async () => {
	const { deps, calls } = createDeps({
		async runFrameworkStage() {
			return stage('framework', 'skipped', []);
		},
		async updateSettingPlugin() {
			return stage('setting-plugin', 'skipped', []);
		},
	});
	const summary = await runFullUpdate(deps);

	assert.equal(summary.wroteAnything, false);
	assert.deepEqual(summary.migratedIds, []);
	assert.equal(summary.failed, 0);
	assert.ok(!calls.includes('reload'), '没写文件就不该重载');
});

test('写过文件后只请求重载一次', async () => {
	const { deps, calls } = createDeps({
		async updateAuxPlugin(key) {
			calls.push(`aux:${key}`);
			return { status: 'up-to-date', pluginId: key };
		},
	});
	// 框架阶段写成 partial 也算写过
	deps.runFrameworkStage = async () => stage('framework', 'partial', []);
	const summary = await runFullUpdate(deps);

	assert.equal(summary.wroteAnything, true);
	assert.equal(calls.filter((call) => call === 'reload').length, 1);
});

test('单个辅助插件失败不中断后续插件，失败计数只算一次', async () => {
	const attempted = [];
	const { deps } = createDeps({
		async updateAuxPlugin(key) {
			attempted.push(key);
			if (key === 'text-popup') {
				throw new Error('network down');
			}
			return { status: 'up-to-date', pluginId: key };
		},
	});
	const summary = await runFullUpdate(deps);

	assert.equal(attempted.length, IOTO_PLUGINS.length, '失败后仍要继续跑完 11 个');
	assert.equal(summary.failed, 1);
	const aux = summary.stages.find((item) => item.stage === 'aux-plugins');
	assert.equal(aux.status, 'partial');
	assert.equal(
		aux.items.find((item) => item.label === 'text-popup').detail,
		'network down',
	);
});

test('框架阶段失败时通知调用方「不要启用 Setting 插件」，但辅助插件照跑', async () => {
	const { deps, calls } = createDeps({
		async runFrameworkStage() {
			throw new Error('gitee 403');
		},
	});
	const summary = await runFullUpdate(deps);

	assert.ok(
		calls.includes('setting:true'),
		`应把 frameworkFailed 传下去，实际: ${calls.join(',')}`,
	);
	assert.equal(
		calls.filter((call) => call.startsWith('aux:')).length,
		IOTO_PLUGINS.length,
	);
	const framework = summary.stages[0];
	assert.equal(framework.status, 'failed');
	assert.equal(framework.items[0].detail, 'gitee 403');
	assert.equal(
		summary.wroteAnything,
		true,
		'Setting 插件阶段仍会写文件，因此整体仍要重载',
	);
});

test('自身阶段可跳过：总单位变 13，且不调用 updateSelf', async () => {
	const { deps, calls } = createDeps();
	const summary = await runFullUpdate(deps, { skipSelf: true });

	assert.equal(summary.total, 13);
	assert.ok(!calls.includes('self'));
	assert.equal(summary.stages.some((item) => item.stage === 'self'), false);
});

test('辅助阶段单位数等于注册表长度（不写死 11）', async () => {
	const { deps } = createDeps();
	const summary = await runFullUpdate(deps);
	const aux = summary.stages.find((item) => item.stage === 'aux-plugins');

	assert.equal(aux.items.length, IOTO_PLUGINS.length);
});

test('开发版本不降级：dev-version 既不算失败也不算写过', async () => {
	const { deps, calls } = createDeps({
		async runFrameworkStage() {
			return stage('framework', 'skipped', []);
		},
		async updateSettingPlugin() {
			return stage('setting-plugin', 'skipped', []);
		},
		async updateAuxPlugin(key) {
			calls.push(`aux:${key}`);
			return { status: 'dev-version', pluginId: key, fromVersion: '9.9.9' };
		},
	});
	const summary = await runFullUpdate(deps);

	assert.equal(summary.failed, 0);
	assert.equal(summary.wroteAnything, false);
	assert.ok(!calls.includes('reload'));
});

test('发生 id 迁移时即使没有 updated 也要重载，并记录迁移', async () => {
	const { deps, calls } = createDeps({
		async updateAuxPlugin(key) {
			calls.push(`aux:${key}`);
			if (key === 'slidesrup') {
				return {
					status: 'updated',
					pluginId: 'slidesrup',
					legacyId: 'slides-rup',
					fromVersion: '1.6.3',
					toVersion: '1.6.4',
				};
			}
			return { status: 'up-to-date', pluginId: key };
		},
	});
	const summary = await runFullUpdate(deps);

	assert.deepEqual(summary.migratedIds, ['slides-rup → slidesrup']);
	assert.equal(calls.filter((call) => call === 'reload').length, 1);
	const aux = summary.stages.find((item) => item.stage === 'aux-plugins');
	assert.equal(
		aux.items.find((item) => item.label === 'slidesrup').detail,
		'1.6.3 → 1.6.4',
	);
});

test('进度事件：每个辅助插件都发 plugin-progress，最后发 finished', async () => {
	const { deps, events } = createDeps();
	await runFullUpdate(deps);

	const progress = events.filter((event) => event.type === 'plugin-progress');
	assert.equal(progress.length, IOTO_PLUGINS.length);
	assert.deepEqual(
		progress.map((event) => event.done),
		IOTO_PLUGINS.map((_entry, index) => 2 + index),
	);
	assert.equal(events.at(-1).type, 'finished');
	assert.equal(events[0].type, 'stage-start');
	assert.equal(events[0].total, 14);
});

test('阶段边界的 stage-end.done 单调递增且覆盖全部单位（面板续值依赖它）', async () => {
	const { deps, events } = createDeps();
	const summary = await runFullUpdate(deps);

	const stageEnds = events.filter((event) => event.type === 'stage-end');
	assert.deepEqual(
		stageEnds.map((event) => event.stage),
		['framework', 'setting-plugin', 'aux-plugins', 'self'],
	);
	assert.deepEqual(
		stageEnds.map((event) => event.done),
		[1, 2, 13, 14],
		'框架 1 + Setting 1 + 11 个辅助插件 + 自身',
	);
	for (let index = 1; index < stageEnds.length; index++) {
		assert.ok(
			stageEnds[index].done > stageEnds[index - 1].done,
			`stage-end.done 必须单调递增，实际: ${stageEnds.map((event) => event.done).join(',')}`,
		);
	}
	assert.equal(stageEnds.at(-1).done, summary.total);
});

test('面板抛错不影响更新链路', async () => {
	const { deps, calls } = createDeps({
		onEvent() {
			throw new Error('panel boom');
		},
	});
	const summary = await runFullUpdate(deps);

	assert.equal(summary.done, summary.total);
	assert.equal(calls.filter((call) => call === 'reload').length, 1);
});
