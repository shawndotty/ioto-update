import { App } from "obsidian";
import { PluginService } from "./plugin-service";

export class IOTOSettingsService extends PluginService {
	constructor(app: App) {
		super(app, "ioto-settings");
	}

	getIOTOPathes() {
		const iotoSettings = this.getPlugin();
		let pathSettings = {};
		if (iotoSettings) {
			const iotoFrameworkPath = iotoSettings.settings.IOTOFrameworkPath;
			pathSettings = {
				iotoFrameworkPath: iotoFrameworkPath,
				userSyncScriptsFolder: `${iotoFrameworkPath}/Templates/Templater/MyIOTO`,
			};
		}
		return pathSettings;
	}
}
