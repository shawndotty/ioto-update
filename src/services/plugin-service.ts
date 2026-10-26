import { App } from "obsidian";
import { LEGACY_PLUGIN_IDS } from "./plugin-registry";

export interface InstalledPluginManifest {
	id: string;
	version: string;
}

export class PluginService {
	private app: App;
	private plugin: any;

	constructor(app: App, id: string) {
		this.app = app;
		this.plugin = this.app.plugins.plugins[id] || null;
	}

	getPluginSetting(settingName: string) {
		if (this.plugin) {
			return this.plugin.settings[settingName];
		}
		return null;
	}

	getPlugin() {
		return this.plugin;
	}

	/**
	 * 插件文件所在的物理目录。
	 *
	 * 优先用 Obsidian 维护的 `manifests[id].dir`（通常是 `.obsidian/plugins/<dir>`），
	 * 取不到时才退回 `<configDir>/plugins/<id>`。
	 * 目录名与 id 不一致时（历史遗留），这一层是唯一能写对位置的地方。
	 */
	static getPluginDir(app: App, pluginId: string): string {
		// @ts-ignore 访问内部 API
		const manifests = app.plugins?.manifests;
		const dir = manifests?.[pluginId]?.dir;
		if (typeof dir === "string" && dir.length > 0) return dir;
		return `${app.vault.configDir}/plugins/${pluginId}`;
	}

	/**
	 * 把远端 id 解析成「本机实际安装的 id」。
	 *
	 * 先按远端 id 查，查不到再查旧 id 别名（见 `LEGACY_PLUGIN_IDS`）。
	 * 返回 `null` 表示未安装。
	 */
	static resolveInstalledPluginId(
		app: App,
		remoteId: string,
	): string | null {
		// @ts-ignore 访问内部 API
		const manifests = app.plugins?.manifests ?? {};
		if (manifests[remoteId]) return remoteId;

		const legacyId = LEGACY_PLUGIN_IDS[remoteId];
		if (legacyId && manifests[legacyId]) return legacyId;

		return null;
	}

	/**
	 * 读取已安装插件在**磁盘上**的 manifest。
	 *
	 * 一键全量链路不能用 `manifests[id].version`：那是插件加载时缓存的值，
	 * 本插件刚写完新 `main.js` 时它仍然滞后（真机实测 SlidesRup 内存 1.6.4 / 磁盘 1.6.5）。
	 * 磁盘读不到时退回内存值，保证旧调用方行为不变。
	 */
	static async readInstalledManifest(
		app: App,
		pluginId: string,
	): Promise<InstalledPluginManifest | null> {
		// @ts-ignore 访问内部 API
		const hint = app.plugins?.manifests?.[pluginId];
		if (!hint) return null;

		try {
			const path = `${this.getPluginDir(app, pluginId)}/manifest.json`;
			const raw = await app.vault.adapter.read(path);
			const manifest = JSON.parse(raw);
			if (manifest && typeof manifest.version === "string") {
				return {
					id:
						typeof manifest.id === "string"
							? manifest.id
							: pluginId,
					version: manifest.version,
				};
			}
		} catch (e) {
			// 磁盘 manifest 缺失或损坏：退回内存值（旧行为）
		}

		return { id: pluginId, version: hint.version };
	}

	/**
	 * 把 `community-plugins.json` 里的旧 id **原地**替换成新 id。
	 *
	 * 只替换、不新增、不重排：用户看到的是插件列表位置不变。
	 * 返回是否真的写了文件。
	 */
	static async migratePluginId(
		app: App,
		oldId: string,
		newId: string,
	): Promise<boolean> {
		if (!oldId || !newId || oldId === newId) return false;

		const adapter = app.vault.adapter;
		const configPath = `${app.vault.configDir}/community-plugins.json`;
		if (!(await adapter.exists(configPath))) return false;

		let enabledPluginsList: unknown;
		try {
			enabledPluginsList = JSON.parse(await adapter.read(configPath));
		} catch (e) {
			console.error("Failed to parse community-plugins.json", e);
			return false;
		}
		if (!Array.isArray(enabledPluginsList)) return false;
		if (!enabledPluginsList.includes(oldId)) return false;

		const replaced: string[] = [];
		for (const id of enabledPluginsList) {
			const next = id === oldId ? newId : id;
			// 去重但保留第一次出现的位置
			if (!replaced.includes(next)) replaced.push(next);
		}

		await adapter.write(configPath, JSON.stringify(replaced, null, 2));
		return true;
	}

	/**
	 * 写盘后的 id 迁移（仅在全部条件满足时执行）：
	 * 1. 命中了旧 id 别名；
	 * 2. 写入后的磁盘 manifest 的 id 已等于远端 id（确认真换了）；
	 * 3. 用户原本就是启用的（`enabledPlugins` 含旧 id）。
	 *
	 * 条件 3 保证「原本未启用的插件不会被迁移成启用」。
	 */
	static async migrateLegacyPluginIdIfNeeded(
		app: App,
		options: {
			remoteId: string;
			legacyId?: string;
			pluginDir: string;
		},
	): Promise<boolean> {
		const { remoteId, legacyId, pluginDir } = options;
		if (!legacyId || legacyId === remoteId) return false;

		// @ts-ignore 访问内部 API
		const enabledPlugins: Set<string> | undefined =
			app.plugins?.enabledPlugins;
		if (!enabledPlugins || !enabledPlugins.has(legacyId)) return false;

		try {
			const raw = await app.vault.adapter.read(
				`${pluginDir}/manifest.json`,
			);
			const manifest = JSON.parse(raw);
			if (manifest?.id !== remoteId) return false;
		} catch (e) {
			return false;
		}

		return this.migratePluginId(app, legacyId, remoteId);
	}

	static async reloadAndEnablePlugin(app: App, pluginId: string) {
		// @ts-ignore
		const plugins = app.plugins;
		if (!plugins) return;

		// 1. Refresh manifests
		// @ts-ignore
		if (plugins.loadManifests) {
			// @ts-ignore
			await plugins.loadManifests();
		}

		// 2. Disable if already enabled (to reload)
		// @ts-ignore
		if (plugins.enabledPlugins.has(pluginId)) {
			// @ts-ignore
			await plugins.disablePlugin(pluginId);
		}

		// 3. Enable plugin
		// @ts-ignore
		await plugins.enablePlugin(pluginId);

		// 4. Persist to community-plugins.json
		const configDir = app.vault.configDir;
		const pluginsConfigPath = `${configDir}/community-plugins.json`;
		const adapter = app.vault.adapter;

		let enabledPluginsList: string[] = [];
		if (await adapter.exists(pluginsConfigPath)) {
			try {
				const content = await adapter.read(pluginsConfigPath);
				enabledPluginsList = JSON.parse(content);
			} catch (e) {
				console.error("Failed to parse community-plugins.json", e);
			}
		}

		if (!enabledPluginsList.includes(pluginId)) {
			enabledPluginsList.push(pluginId);
			await adapter.write(
				pluginsConfigPath,
				JSON.stringify(enabledPluginsList, null, 2),
			);
		}
	}
}
