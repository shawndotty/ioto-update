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
}
