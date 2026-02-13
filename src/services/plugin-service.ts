import { App } from "obsidian";

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
