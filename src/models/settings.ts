import { App } from "obsidian";
import { IOTOUpdateSettings } from "../types";
import { DEFAULT_SETTINGS } from "./default-settings";
import { IOTOSettingsService } from "src/services/ioto-settings-service";

export class SettingsManager {
	private settings: IOTOUpdateSettings;
	private iotoSettingsService: IOTOSettingsService;

	constructor(
		private loadData: () => Promise<any>,
		private saveData: (data: any) => Promise<void>,
		private app: App
	) {
		this.settings = Object.assign({}, DEFAULT_SETTINGS);
		this.iotoSettingsService = new IOTOSettingsService(this.app);
	}

	async load() {
		let pathSettings = this.iotoSettingsService.getIOTOPathes();

		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			pathSettings,
			await this.loadData()
		);
		return this.settings;
	}

	async save() {
		await this.saveData(this.settings);
	}

	get() {
		return this.settings;
	}

	update(settings: Partial<IOTOUpdateSettings>) {
		this.settings = { ...this.settings, ...settings };
	}
}
