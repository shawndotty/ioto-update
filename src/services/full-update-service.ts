/**
 * 「一键更新完整 IOTO」的编排器。
 *
 * 设计约束（来自 Plan-20261026-093017）：
 * - 阶段之间**串行**，阶段内失败**不中断**（一个插件坏了不能拖住其余 10 个）；
 * - 全程只重载一次，且只在真的写过文件（或发生过 id 迁移）时重载；
 * - 不自己发 `Notice`，状态全部通过 `onEvent` 交给进度面板（避免 11 个插件刷屏）；
 * - 自身（ioto-update）放最后：它一写完 `main.js`，当前会话里的代码就是旧的了。
 *
 * 本文件不 import 任何下载 / Vault 能力，全部依赖注入，单测里可以完整替换。
 */

import type { InstallPluginResult } from "./install-types";

export type FullUpdateStageName =
	| "framework"
	| "setting-plugin"
	| "aux-plugins"
	| "self";

export interface StageItem {
	label: string;
	status: string;
	detail?: string;
}

export interface StageResult {
	stage: FullUpdateStageName;
	status: "done" | "partial" | "failed" | "skipped";
	items: StageItem[];
}

export interface FullUpdateSummary {
	/** 进度总单位数：1（框架）+ 1（设置插件）+ N（辅助插件）+ 1（自身） */
	total: number;
	/** 已完成单位数 */
	done: number;
	/** 是否写过文件（决定要不要重载） */
	wroteAnything: boolean;
	/** 是否发生过插件 id 迁移（也会触发重载） */
	migratedIds: string[];
	/** 失败条目数 */
	failed: number;
	stages: StageResult[];
}

export type FullUpdateEvent =
	| { type: "stage-start"; stage: FullUpdateStageName; total: number }
	| { type: "framework-progress"; done: number; total: number }
	| {
			type: "plugin-progress";
			stage: FullUpdateStageName;
			index: number;
			total: number;
			/** 进入本插件前已完成的进度单位数 */
			done: number;
			key: string;
	  }
	| {
			type: "stage-end";
			stage: FullUpdateStageName;
			/** 本阶段结束后的累计进度单位数 */
			done: number;
			result: StageResult;
	  }
	| { type: "finished"; summary: FullUpdateSummary };

export interface FullUpdateDeps {
	/** 辅助插件 key 列表（顺序即执行顺序），长度决定阶段 3 的进度单位数 */
	auxPluginKeys: string[];
	/**
	 * 阶段 1：框架文件（core / help docs / myioto / css 四张表）。
	 * `onProgress` 是文件级进度，只用于展示「正在拉多少」，
	 * 不参与 n/14 的累计。
	 */
	runFrameworkStage(
		onProgress: (done: number, total: number) => void,
	): Promise<StageResult>;
	/**
	 * 阶段 2：Framework Setting 插件。
	 *
	 * `frameworkFailed` 为真时调用方**不应**去启用 ioto-settings
	 * （文件没下全，启用没有意义），但本阶段仍要执行。
	 */
	updateSettingPlugin(context: {
		frameworkFailed: boolean;
	}): Promise<StageResult>;
	/** 阶段 3：单个辅助插件（由调用方决定「未安装则跳过」） */
	updateAuxPlugin(key: string): Promise<InstallPluginResult>;
	/** 阶段 4：自身 */
	updateSelf(): Promise<InstallPluginResult>;
	/** 请求重载（实现方可以延迟执行，例如等面板倒计时） */
	reloadApp(): void;
	/** 进度事件订阅（面板） */
	onEvent?: (event: FullUpdateEvent) => void;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function stageFailedItems(stage: StageResult): number {
	return stage.items.filter((item) => item.status === "failed").length;
}

/**
 * 执行完整更新链路。
 *
 * 返回值是唯一真相：面板、命令回调都只读它。
 */
export async function runFullUpdate(
	deps: FullUpdateDeps,
	options: { skipSelf?: boolean } = {},
): Promise<FullUpdateSummary> {
	const keys = deps.auxPluginKeys.slice();
	const includeSelf = options.skipSelf !== true;
	const total = 2 + keys.length + (includeSelf ? 1 : 0);

	const stages: StageResult[] = [];
	const migratedIds: string[] = [];
	let done = 0;
	let wroteAnything = false;
	let failed = 0;

	// 面板异常绝不能打断更新
	const emit = (event: FullUpdateEvent) => {
		try {
			deps.onEvent?.(event);
		} catch (e) {
			console.error("Full update progress panel error:", e);
		}
	};

	// ---- 阶段 1：框架文件 ----
	emit({ type: "stage-start", stage: "framework", total });
	let framework: StageResult;
	try {
		framework = await deps.runFrameworkStage((fileDone, fileTotal) =>
			emit({
				type: "framework-progress",
				done: fileDone,
				total: fileTotal,
			}),
		);
	} catch (e) {
		framework = {
			stage: "framework",
			status: "failed",
			items: [{ label: "framework", status: "failed", detail: errorMessage(e) }],
		};
	}
	stages.push(framework);
	done += 1;
	failed += stageFailedItems(framework);
	if (framework.status === "done" || framework.status === "partial") {
		wroteAnything = true;
	}
	emit({ type: "stage-end", stage: "framework", done, result: framework });

	const frameworkFailed = framework.status !== "done";

	// ---- 阶段 2：Framework Setting 插件 ----
	emit({ type: "stage-start", stage: "setting-plugin", total });
	let settingPlugin: StageResult;
	try {
		settingPlugin = await deps.updateSettingPlugin({ frameworkFailed });
	} catch (e) {
		settingPlugin = {
			stage: "setting-plugin",
			status: "failed",
			items: [
				{ label: "setting-plugin", status: "failed", detail: errorMessage(e) },
			],
		};
	}
	stages.push(settingPlugin);
	done += 1;
	failed += stageFailedItems(settingPlugin);
	if (settingPlugin.status === "done" || settingPlugin.status === "partial") {
		wroteAnything = true;
	}
	emit({ type: "stage-end", stage: "setting-plugin", done, result: settingPlugin });

	// ---- 阶段 3：辅助插件（逐个串行，失败不中断） ----
	emit({ type: "stage-start", stage: "aux-plugins", total });
	const auxItems: StageItem[] = [];
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index];
		emit({
			type: "plugin-progress",
			stage: "aux-plugins",
			index,
			total: keys.length,
			done,
			key,
		});

		let result: InstallPluginResult;
		try {
			result = await deps.updateAuxPlugin(key);
		} catch (e) {
			result = { status: "failed", pluginId: key, error: errorMessage(e) };
		}

		const detail = result.error
			? result.error
			: result.fromVersion && result.toVersion
			? `${result.fromVersion} → ${result.toVersion}`
			: undefined;
		auxItems.push({ label: key, status: result.status, detail });

		if (result.status === "updated") {
			wroteAnything = true;
			if (result.legacyId) {
				migratedIds.push(`${result.legacyId} → ${result.pluginId ?? key}`);
			}
		}
		if (result.status === "failed" || result.status === "not-found") {
			failed += 1;
		}
		done += 1;
	}

	const auxStage: StageResult = {
		stage: "aux-plugins",
		status: auxItems.some((item) => item.status === "failed")
			? auxItems.every((item) => item.status === "failed")
				? "failed"
				: "partial"
			: "done",
		items: auxItems,
	};
	stages.push(auxStage);
	emit({ type: "stage-end", stage: "aux-plugins", done, result: auxStage });

	// ---- 阶段 4：自身（最后执行） ----
	if (includeSelf) {
		emit({ type: "stage-start", stage: "self", total });
		let selfResult: InstallPluginResult;
		try {
			selfResult = await deps.updateSelf();
		} catch (e) {
			selfResult = {
				status: "failed",
				pluginId: "ioto-update",
				error: errorMessage(e),
			};
		}
		const selfStage: StageResult = {
			stage: "self",
			status:
				selfResult.status === "updated" || selfResult.status === "up-to-date"
					? "done"
					: selfResult.status === "dev-version" ||
					  selfResult.status === "skipped"
					? "skipped"
					: "failed",
			items: [
				{
					label: "ioto-update",
					status: selfResult.status,
					detail: selfResult.error,
				},
			],
		};
		stages.push(selfStage);
		done += 1;
		if (selfResult.status === "updated") wroteAnything = true;
		if (selfResult.status === "failed" || selfResult.status === "not-found") {
			failed += 1;
		}
		emit({ type: "stage-end", stage: "self", done, result: selfStage });
	}

	const summary: FullUpdateSummary = {
		total,
		done,
		wroteAnything,
		migratedIds,
		failed,
		stages,
	};
	emit({ type: "finished", summary });

	if (wroteAnything || migratedIds.length > 0) {
		deps.reloadApp();
	}

	return summary;
}
