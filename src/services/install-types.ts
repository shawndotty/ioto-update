/**
 * 「安装 / 更新一个插件」的公共契约。
 *
 * 以前 `installPluginFrom` 返回 `void`，调用方只能靠 Notice 猜测结果；
 * 一键更新完整 IOTO 需要逐项汇报状态，因此这里把返回值固定下来。
 * 两个下载源（GitHub / Gitee）必须返回同一种结构。
 */

export interface InstallPluginOptions {
	/**
	 * 安装 / 更新文件后是否立即调用 `PluginService.reloadAndEnablePlugin`。
	 *
	 * 默认 `true`（保持旧行为）；一键全量链路一律传 `false`，
	 * 由编排器在最后统一 `app:reload` 一次。
	 */
	autoReload?: boolean;
	/**
	 * 是否静音。`true` 时不发任何 `Notice`，状态只通过返回值上报。
	 * 默认 `false`。
	 */
	silent?: boolean;
}

export type InstallPluginStatus =
	| "updated"
	| "up-to-date"
	| "failed"
	| "not-found"
	| "skipped"
	| "dev-version";

export interface InstallPluginResult {
	status: InstallPluginStatus;
	/** 写入/判定时使用的远端 manifest id */
	pluginId?: string;
	/** 命中旧 id 迁移时带上旧 id */
	legacyId?: string;
	name?: string;
	fromVersion?: string;
	toVersion?: string;
	/** 失败原因（status 为 failed / not-found 时） */
	error?: string;
}
