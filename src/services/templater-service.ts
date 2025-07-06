import { App } from "obsidian";

export class TemplaterService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	private getTemplater() {
		const templater = this.app.plugins.plugins["templater-obsidian"];
		return templater || null;
	}

	getTemplaterSetting(settingName: string) {
		const templater = this.getTemplater();
		if (templater) {
			return templater.settings[settingName];
		}
		return null;
	}

	async setTemplaterSetting(settingName: string, value: any) {
		const templater = this.getTemplater();
		if (templater) {
			templater.settings[settingName] = value;
			await templater.save_settings();
			await templater.event_handler.update_trigger_file_on_creation();
		}
	}
}
