import { App, Notice, Plugin } from "obsidian";
import { t } from "../lang/helpers";
import {
	AirtableIds,
	IOTOUpdateSettings,
	NocoDBTable,
	NocoDBSettings,
} from "../types";
import { NocoDB } from "./db-syncer/nocodb";
import { NocoDBSync } from "./db-syncer/nocodb-sync";
import { ObsidianSyncer } from "./db-syncer/ob-syncer";
import { Utils } from "../utils";
import { TemplaterService } from "./templater-service";

export class CommandService {
	private app: App;
	private plugin: Plugin;
	private settings: IOTOUpdateSettings;
	private templaterService: TemplaterService;
	private userSyncSettingAirtableIds: AirtableIds | null;

	constructor(
		app: App,
		plugin: Plugin,
		settings: IOTOUpdateSettings,
		templaterService: TemplaterService
	) {
		this.app = app;
		this.plugin = plugin;
		this.settings = settings;
		this.templaterService = templaterService;
		this.userSyncSettingAirtableIds = Utils.extractAirtableIds(
			this.settings.userSyncSettingUrl
		);
	}

	registerCommands() {
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

		// 创建所有命令
		this.createNocoDBCommand(
			"get-core-files",
			t("Update Core Files"),
			tableConfigs.coreFiles
		);
		this.createNocoDBCommand(
			"get-help-doc",
			t("Update Help Docs"),
			tableConfigs.helpDocs,
			false,
			true,
			true
		);
		this.createNocoDBCommand(
			"get-myioto",
			t("Update MYIOTO Templates"),
			tableConfigs.myIoto
		);
		this.createNocoDBCommand(
			"get-css",
			t("Update CSS Snippets"),
			tableConfigs.cssSnippets,
			true
		);
		this.createNocoDBCommand(
			"get-setting-plugin",
			t("Update IOTO Framwork Setting Plugin"),
			tableConfigs.settingPlugin,
			true
		);
		this.createNocoDBCommand(
			"get-user-sync-scripts",
			t("Get Your Personal Sync Templates"),
			tableConfigs.userSyncScripts,
			false,
			false,
			false,
			this.settings.userAPIKey,
			true
		);

		this.createRunAllUpdatesCommand(tableConfigs);
	}

	async executeNocoDBCommand(
		tableConfig: NocoDBTable,
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
		const nocoDB = new NocoDB(nocoDBSettings);
		const nocoDBSync = new NocoDBSync(nocoDB, this.app);
		const obSyncer = new ObsidianSyncer(this.app, nocoDBSync);
		await obSyncer.onlyFetchFromNocoDB(
			tableConfig,
			iotoUpdate,
			this.settings.updateAPIKeyIsValid,
			filterRecordsByDate
		);
	}

	createNocoDBCommand(
		id: string,
		name: string,
		tableConfig: NocoDBTable,
		reloadOB: boolean = false,
		iotoUpdate: boolean = true,
		filterRecordsByDate: boolean = false,
		apiKey: string = this.settings.updateAPIKey,
		forceEnSyncFields: boolean = false
	) {
		this.plugin.addCommand({
			id,
			name,
			callback: async () => {
				const templaterTrigerAtCreate =
					this.templaterService.getTemplaterSetting(
						"trigger_on_file_creation"
					);
				if (templaterTrigerAtCreate) {
					await this.templaterService.setTemplaterSetting(
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
					await this.templaterService.setTemplaterSetting(
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
	}

	createRunAllUpdatesCommand(tableConfigs: {
		coreFiles: NocoDBTable;
		helpDocs: NocoDBTable;
		myIoto: NocoDBTable;
		cssSnippets: NocoDBTable;
		settingPlugin: NocoDBTable;
	}) {
		this.plugin.addCommand({
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

				const templaterTrigerAtCreate =
					this.templaterService.getTemplaterSetting(
						"trigger_on_file_creation"
					);
				if (templaterTrigerAtCreate) {
					console.log(
						"templaterTrigerAtCreate",
						templaterTrigerAtCreate
					);
					await this.templaterService.setTemplaterSetting(
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
					await this.templaterService.setTemplaterSetting(
						"trigger_on_file_creation",
						true
					);
				}

				if (successCount === updateTasks.length) {
					this.app.commands.executeCommandById("app:reload");
				}
			},
		});
	}
}
