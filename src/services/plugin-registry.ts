/**
 * IOTO 辅助插件注册表。
 *
 * 此处集中维护所有可从 GitHub / Gitee 下载安装的 IOTO 生态插件，
 * 供命令面板（command-service.ts）与设置页 Plugins Center 共用，
 * 避免仓库 URL 等信息在多处重复硬编码。
 */

import type en from "../lang/locale/en";

type LangKey = keyof typeof en;

export interface IOTOPluginEntry {
	/** 唯一标识，用于在列表中区分插件 */
	key: string;
	/** 显示名称对应的 i18n key */
	nameKey: LangKey;
	/** 插件描述对应的 i18n key */
	descKey: LangKey;
	/** GitHub 仓库地址 */
	githubUrl: string;
	/** Gitee 仓库地址 */
	giteeUrl: string;
	/** 是否需要 viewID 白名单鉴权（目前仅同步脚本生成器需要） */
	requireViewID?: boolean;
}

/**
 * 允许使用 Sync Scripts Generator 的 iotoSettingPlugin.viewID 白名单。
 * 与 command-service.ts 中的判断保持一致。
 */
export const SSG_VIEW_ID_WHITELIST = ["viwZvtQy1GDWu00sA", "viwwopZSx1IGoTiJE"];

export const IOTO_PLUGINS: IOTOPluginEntry[] = [
	{
		key: "ioto-template-generator",
		nameKey: "IOTO Template Generator",
		descKey: "IOTO Template Generator.desc",
		githubUrl: "https://github.com/shawndotty/ioto-template-generator",
		giteeUrl: "https://gitee.com/johnnylearns/ioto-template-generator",
	},
	{
		key: "sync-script-generator",
		nameKey: "Sync Scripts Generator",
		descKey: "Sync Scripts Generator.desc",
		githubUrl: "https://github.com/shawndotty/sync-script-generator",
		giteeUrl: "https://gitee.com/johnnylearns/sync-script-generator",
		requireViewID: true,
	},
	{
		key: "ioto-dashboard",
		nameKey: "IOTO Dashboard",
		descKey: "IOTO Dashboard.desc",
		githubUrl: "https://github.com/shawndotty/ioto-dashboard",
		giteeUrl: "https://gitee.com/johnnylearns/ioto-dashboard",
	},
	{
		key: "ioto-tasks-center",
		nameKey: "IOTO Tasks Center",
		descKey: "IOTO Tasks Center.desc",
		githubUrl: "https://github.com/shawndotty/ioto-tasks-center",
		giteeUrl: "https://gitee.com/johnnylearns/ioto-tasks-center",
	},
	{
		key: "text-popup",
		nameKey: "Text Popup",
		descKey: "Text Popup.desc",
		githubUrl: "https://github.com/shawndotty/text-popup",
		giteeUrl: "https://gitee.com/johnnylearns/text-popup",
	},
	{
		key: "my-text-tools",
		nameKey: "My Text Tools",
		descKey: "My Text Tools.desc",
		githubUrl: "https://github.com/shawndotty/my-text-tools",
		giteeUrl: "https://gitee.com/johnnylearns/my-text-tools",
	},
	{
		key: "slidesrup",
		nameKey: "SlidesRup",
		descKey: "SlidesRup.desc",
		githubUrl: "https://github.com/shawndotty/slidesrup",
		giteeUrl: "https://gitee.com/johnnylearns/slidesrup",
	},
	{
		key: "obsidian-airtable-fetcher",
		nameKey: "Airtable Fetcher",
		descKey: "Airtable Fetcher.desc",
		githubUrl: "https://github.com/shawndotty/obsidian-airtable-fetcher",
		giteeUrl: "https://gitee.com/johnnylearns/obsidian-airtable-fetcher",
	},
	{
		key: "obsidian-feishu-fetcher",
		nameKey: "Feishu Fetcher",
		descKey: "Feishu Fetcher.desc",
		githubUrl: "https://github.com/shawndotty/obsidian-feishu-fetcher",
		giteeUrl: "https://gitee.com/johnnylearns/obsidian-feishu-fetcher",
	},
	{
		key: "obsidian-vika-fetcher",
		nameKey: "Vika Fetcher",
		descKey: "Vika Fetcher.desc",
		githubUrl: "https://github.com/shawndotty/obsidian-vika-fetcher",
		giteeUrl: "https://gitee.com/johnnylearns/obsidian-vika-fetcher",
	},
];

/**
 * 判断给定的 viewID 是否在 SSG 白名单中。
 * @param viewID iotoSettingPlugin.viewID
 */
export function isSSGViewIDAllowed(viewID?: string): boolean {
	if (!viewID) return false;
	return SSG_VIEW_ID_WHITELIST.includes(viewID);
}
