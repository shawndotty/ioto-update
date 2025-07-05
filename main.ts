import { App, Notice, normalizePath, Plugin, moment } from "obsidian";
import { t } from "./lang/helpers";
import {
	AirtableIds,
	IOTOUpdateSettings,
	NocoDBTable,
	NocoDBSettings,
	RecordFields,
	Record,
	DateFilterOption,
} from "./src/types";
import { DEFAULT_SETTINGS, IOTOUpdateSettingTab } from "./src/settings";
import { MyObsidian } from "./src/MyObsidian";
import { MyNocoDB } from "./src/MyNocoDB";
import { NocoDBSync } from "./src/NocoDBSync";
import { ApiService } from "./src/api";
import { Utils } from "./src/utils";

// 扩展 App 类型以包含 commands 属性
declare module "obsidian" {
	interface App {
		commands: {
			executeCommandById(id: string): void;
		};
		plugins: {
			plugins: {
				[key: string]: any;
			};
		};
	}
}

export default class IOTOUpdate extends Plugin {
	settings: IOTOUpdateSettings;
	userSyncSettingAirtableIds: AirtableIds | null;
	public apiService: ApiService;

	async onload() {
		await this.loadSettings();
		this.apiService = new ApiService(this.settings);

		this.userSyncSettingAirtableIds = Utils.extractAirtableIds(
			this.settings.userSyncSettingUrl
		);

		// 定义所有 tableConfig 配置
		const tableConfigs = {
			coreFiles: {
				baseID: this.settings.updateIDs.iotoCore.baseID,
				tableID: this.settings.updateIDs.iotoCore.tableID,
				viewID: this.settings.updateIDs.iotoCore.viewID,
				targetFolderPath: this.settings.iotoFrameworkPath,
			},
			helpDocs: {
				baseID: this.settings.updateIDs.iotoHelpDocs.baseID,
				tableID: this.settings.updateIDs.iotoHelpDocs.tableID,
				viewID: this.settings.updateIDs.iotoHelpDocs.viewID,
				targetFolderPath: this.settings.iotoFrameworkPath,
			},
			myIoto: {
				baseID: this.settings.updateIDs.myIotoFull.baseID,
				tableID: this.settings.updateIDs.myIotoFull.tableID,
				viewID: this.settings.updateIDs.myIotoFull.viewID,
				targetFolderPath: this.settings.iotoFrameworkPath,
			},
			cssSnippets: {
				baseID: this.settings.updateIDs.iotoCssSnippets.baseID,
				tableID: this.settings.updateIDs.iotoCssSnippets.tableID,
				viewID: this.settings.updateIDs.iotoCssSnippets.viewID,
				targetFolderPath: `${this.app.vault.configDir}`,
			},
			settingPlugin: {
				baseID: this.settings.updateIDs.iotoSettingPlugin.baseID,
				tableID: this.settings.updateIDs.iotoSettingPlugin.tableID,
				viewID: this.settings.updateIDs.iotoSettingPlugin.viewID,
				targetFolderPath: `${this.app.vault.configDir}`,
			},
			userSyncScripts: {
				baseID: this.userSyncSettingAirtableIds?.baseId || "",
				tableID: this.userSyncSettingAirtableIds?.tableId || "",
				viewID: this.userSyncSettingAirtableIds?.viewId || "",
				targetFolderPath: this.settings.userSyncScriptsFolder,
			},
		};

		// 优化后的 addCommand 方法，减少重复代码，提升可维护性
		const createNocoDBCommand = (
			id: string,
			name: string,
			tableConfig: {
				viewID: string;
				targetFolderPath: string;
				baseID?: string;
				tableID?: string;
				intialSetup?: boolean;
			},
			reloadOB: boolean = false,
			iotoUpdate: boolean = true,
			filterRecordsByDate: boolean = false,
			apiKey: string = this.settings.updateAPIKey,
			forceEnSyncFields: boolean = false
		) => {
			this.addCommand({
				id,
				name,
				callback: async () => {
					const templaterTrigerAtCreate = this.getTemplaterSetting(
						"trigger_on_file_creation"
					);
					if (templaterTrigerAtCreate) {
						await this.setTemplaterSetting(
							"trigger_on_file_creation",
							false
						);
					}
					await this.executeNocoDBCommand(
						tableConfig,
						iotoUpdate,
						filterRecordsByDate,
						apiKey,
						forceEnSyncFields
					);
					if (templaterTrigerAtCreate) {
						await this.setTemplaterSetting(
							"trigger_on_file_creation",
							true
						);
					}
					if (reloadOB) {
						setTimeout(() => {
							this.app.commands.executeCommandById("app:reload");
						}, 1000);
						return;
					}
				},
			});
		};

		createNocoDBCommand(
			"get-core-files",
			t("Update Core Files"),
			tableConfigs.coreFiles
		);
		createNocoDBCommand(
			"get-help-doc",
			t("Update Help Docs"),
			tableConfigs.helpDocs,
			false,
			true,
			true
		);
		createNocoDBCommand(
			"get-myioto",
			t("Update MYIOTO Templates"),
			tableConfigs.myIoto
		);
		createNocoDBCommand(
			"get-css",
			t("Update CSS Snippets"),
			tableConfigs.cssSnippets,
			true
		);
		createNocoDBCommand(
			"get-setting-plugin",
			t("Update IOTO Framwork Setting Plugin"),
			tableConfigs.settingPlugin,
			true
		);
		createNocoDBCommand(
			"get-user-sync-scripts",
			t("Get Your Personal Sync Templates"),
			tableConfigs.userSyncScripts,
			false,
			false,
			false,
			this.settings.userAPIKey,
			true
		);

		this.addCommand({
			id: "run-all-updates",
			name: t("Deploy IOTO With One Click"),
			callback: async () => {
				const updateTasks = [
					{
						id: "ioto-update:get-setting-plugin",
						name: t("Get IOTO Framework Setting Plugin"),
						tableConfig: tableConfigs.settingPlugin,
					},
					{
						id: "ioto-update:get-css",
						name: t("Get CSS Snippets"),
						tableConfig: tableConfigs.cssSnippets,
					},
					{
						id: "ioto-update:get-core-files",
						name: t("Get Core Files"),
						tableConfig: tableConfigs.coreFiles,
					},
					{
						id: "ioto-update:get-myioto",
						name: t("Get MYIOTO Templates"),
						tableConfig: {
							...tableConfigs.myIoto,
							intialSetup: true,
						},
					},
					{
						id: "ioto-update:get-help-doc",
						name: t("Get Help Docs"),
						tableConfig: tableConfigs.helpDocs,
					},
				];

				let successCount = 0;

				const templaterTrigerAtCreate = this.getTemplaterSetting(
					"trigger_on_file_creation"
				);
				if (templaterTrigerAtCreate) {
					console.log(
						"templaterTrigerAtCreate",
						templaterTrigerAtCreate
					);
					await this.setTemplaterSetting(
						"trigger_on_file_creation",
						false
					);
				}

				for (const task of updateTasks) {
					try {
						new Notice(`${t("Executing")} ${task.name}...`);
						await this.executeNocoDBCommand(task.tableConfig);
						await new Promise((resolve) =>
							setTimeout(resolve, 5000)
						);
						new Notice(`${task.name} ${t("completed")}`);
						successCount++;
					} catch (error) {
						new Notice(`${task.name} ${t("failed")}`);
					}
				}

				if (templaterTrigerAtCreate) {
					await this.setTemplaterSetting(
						"trigger_on_file_creation",
						true
					);
				}

				if (successCount === updateTasks.length) {
					this.app.commands.executeCommandById("app:reload");
				}
			},
		});

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

	private getTemplater() {
		const templater = this.app.plugins.plugins["templater-obsidian"];
		this.app.plugins.plugins["templater-obsidian"];

		return templater || null;
	}

	private getTemplaterSetting(settingName: string) {
		const templater = this.getTemplater();
		if (templater) {
			return templater.settings[settingName];
		}
		return null;
	}

	private async setTemplaterSetting(settingName: string, value: any) {
		const templater = this.getTemplater();
		if (templater) {
			templater.settings[settingName] = value;
			await templater.save_settings();
			await templater.event_handler.update_trigger_file_on_creation();
		}
	}

	async executeNocoDBCommand(
		tableConfig: {
			viewID: string;
			targetFolderPath: string;
			baseID?: string;
			tableID?: string;
			intialSetup?: boolean;
		},
		iotoUpdate: boolean = true,
		filterRecordsByDate: boolean = false,
		apiKey: string = this.settings.updateAPIKey,
		forceDefaultFetchFields: boolean = false
	) {
		const fieldNames = Utils.buildFieldNames(forceDefaultFetchFields);
		const nocoDBSettings: NocoDBSettings = {
			apiKey: apiKey,
			tables: [tableConfig],
			iotoUpdate: iotoUpdate,
			syncSettings: {
				recordFieldsNames: fieldNames,
			},
		};
		const nocoDB = new MyNocoDB(nocoDBSettings);
		const nocoDBSync = new NocoDBSync(nocoDB, this.app);
		const myObsidian = new MyObsidian(this.app, nocoDBSync);
		await myObsidian.onlyFetchFromNocoDB(
			tableConfig,
			iotoUpdate,
			this.settings.updateAPIKeyIsValid,
			filterRecordsByDate
		);
	}
}

declare function requestUrl(options: any): Promise<any>;
