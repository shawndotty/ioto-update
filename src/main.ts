import { Plugin } from "obsidian";
import { IOTOUpdateSettings } from "./types";
import { SettingsManager } from "./models/settings";
import { IOTOUpdateSettingTab } from "./ui/settings-tab";
import { ApiService } from "./services/api-service";
import { CommandService } from "./services/command-service";
import { TemplaterService } from "./services/templater-service";

export default class IOTOUpdate extends Plugin {
	settings: IOTOUpdateSettings;
	settingsManager: SettingsManager;
	public apiService: ApiService;
	private templaterService: TemplaterService;
	private commandService: CommandService;

	async onload() {
		this.settingsManager = new SettingsManager(
			() => this.loadData(),
			(data) => this.saveData(data),
			this.app
		);
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
		this.settings = await this.settingsManager.load();
	}

	async saveSettings() {
		this.settingsManager.update(this.settings);
		await this.settingsManager.save();
	}
}
