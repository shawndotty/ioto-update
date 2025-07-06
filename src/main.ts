import { Plugin } from "obsidian";
import { IOTOUpdateSettings } from "./types";
import { SettingsManager } from "./models/settings";
import { IOTOUpdateSettingTab } from "./ui/settings-tab";
import { ApiService } from "./services/api-service";
import { CommandService } from "./services/command-service";
import { TemplaterService } from "./services/templater-service";
import { ServiceContainer } from "./services/service-container";

export default class IOTOUpdate extends Plugin {
	settings: IOTOUpdateSettings;
	settingsManager: SettingsManager;
	public apiService: ApiService;
	private templaterService: TemplaterService;
	private commandService: CommandService;
	private services: ServiceContainer;

	async onload() {
		this.services = new ServiceContainer(this);
		this.settingsManager = this.services.settingsManager;
		await this.loadSettings();

		this.apiService = this.services.apiService;
		this.templaterService = this.services.templaterService;
		// 初始化 CommandService
		this.commandService = this.services.commandService;

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
