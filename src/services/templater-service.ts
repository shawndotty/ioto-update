import { App } from "obsidian";
import { PluginService } from "./plugin-service";

export class TemplaterService extends PluginService {
	constructor(app: App) {
		super(app, "templater-obsidian");
	}

	async setTemplaterSetting(settingName: string, value: any) {
		const templater = this.getPlugin();
		if (templater) {
			templater.settings[settingName] = value;
			await templater.save_settings();
			if ("trigger_on_file_creation" === settingName) {
				await templater.event_handler.update_trigger_file_on_creation();
			}
		}
	}
}
