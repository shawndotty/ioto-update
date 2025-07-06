import { Plugin } from "obsidian";
import { IOTOUpdateSettings } from "./types";
import { IOTOUpdateSettingTab } from "./ui/settings";
import { DEFAULT_SETTINGS } from "./models/default-settings";
import { ApiService } from "./services/api-service";
import { CommandService } from "./services/command-service";
import { TemplaterService } from "./services/templater-service";

export default class IOTOUpdate extends Plugin {
	settings: IOTOUpdateSettings;
	public apiService: ApiService;
	private templaterService: TemplaterService;
	private commandService: CommandService;

	async onload() {
		await this.loadSettings();
		this.apiService = new ApiService(this.settings);
		this.templaterService = new TemplaterService(this.app);
		// 初始化 CommandService
		this.commandService = new CommandService(
			this.app,
			this,
			this.settings,
			this.templaterService
		);

		// 注册所有命令
		this.commandService.registerCommands();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new IOTOUpdateSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		const iotoSettings = this.app.plugins.plugins["ioto-settings"];
		let pathSettings = {};
		if (iotoSettings) {
			const iotoFrameworkPath = iotoSettings.settings.IOTOFrameworkPath;
			pathSettings = {
				iotoFrameworkPath: iotoFrameworkPath,
				userSyncScriptsFolder: `${iotoFrameworkPath}/Templates/Templater/MyIOTO`,
			};
		}

		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			pathSettings,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
