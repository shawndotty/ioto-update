/**
 * Pre-Release 通道判定。
 *
 * 判定口径为「两个 viewID 精确匹配且取与」，不做 data JSON 文本包含，
 * 避免只命中一个 ID 时误判。两个下载源、命令层与设置页共用这一处口径。
 */

import type { IOTOUpdateSettings } from "../types";

/** 具备 Pre-Release 测试权限的两个 viewID。 */
export const PRERELEASE_VIEW_IDS = {
	iotoCore: "viwqBVs5ACJWMVPUw",
	myIotoFull: "viw0onUesG10His4r",
} as const;

/**
 * 当前用户是否处于 Pre-Release 通道。
 * 两个字段必须同时命中，缺一即视为正式通道。
 */
export function isPreReleaseChannel(settings: IOTOUpdateSettings): boolean {
	return (
		settings?.updateIDs?.iotoCore?.viewID === PRERELEASE_VIEW_IDS.iotoCore &&
		settings?.updateIDs?.myIotoFull?.viewID === PRERELEASE_VIEW_IDS.myIotoFull
	);
}
