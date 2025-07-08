import { App, Command, Notice } from "obsidian";
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

interface CommandConfig {
	id: string;
	name: string;
	tableConfig: () => NocoDBTable;
	reloadOB?: boolean;
	iotoUpdate?: boolean;
	filterRecordsByDate?: boolean;
	apiKey?: () => string;
	forceEnSyncFields?: boolean;
	isPartOfAllUpdates?: boolean;
}

export class CommandService {
	private app: App;
	private addCommand: (command: Command) => void;
	private settings: IOTOUpdateSettings;
	private templaterService: TemplaterService;
	private userSyncSettingAirtableIds: AirtableIds | null;

	constructor(
		app: App,
		addCommand: (command: Command) => void,
		settings: IOTOUpdateSettings,
		templaterService: TemplaterService
	) {
		this.app = app;
		this.addCommand = addCommand;
		this.settings = settings;
		this.templaterService = templaterService;
		this.userSyncSettingAirtableIds = Utils.extractAirtableIds(
			this.settings.userSyncSettingUrl
		);
	}

	private getCommandConfigs(): CommandConfig[] {
		return [
			{
				id: "get-core-files",
				name: t("Update Core Files"),
				tableConfig: () => ({
					baseID: this.settings.updateIDs.iotoCore.baseID,
					tableID: this.settings.updateIDs.iotoCore.tableID,
					viewID: this.settings.updateIDs.iotoCore.viewID,
					targetFolderPath: this.settings.iotoFrameworkPath,
				}),
				isPartOfAllUpdates: true,
			},
			{
				id: "get-help-doc",
				name: t("Update Help Docs"),
				tableConfig: () => ({
					baseID: this.settings.updateIDs.iotoHelpDocs.baseID,
					tableID: this.settings.updateIDs.iotoHelpDocs.tableID,
					viewID: this.settings.updateIDs.iotoHelpDocs.viewID,
					targetFolderPath: this.settings.iotoFrameworkPath,
				}),
				iotoUpdate: false,
				filterRecordsByDate: true,
				isPartOfAllUpdates: true,
			},
			{
				id: "get-myioto",
				name: t("Update MYIOTO Templates"),
				tableConfig: () => ({
					baseID: this.settings.updateIDs.myIotoFull.baseID,
					tableID: this.settings.updateIDs.myIotoFull.tableID,
					viewID: this.settings.updateIDs.myIotoFull.viewID,
					targetFolderPath: this.settings.iotoFrameworkPath,
				}),
				isPartOfAllUpdates: true,
			},
			{
				id: "get-css",
				name: t("Update CSS Snippets"),
				tableConfig: () => ({
					baseID: this.settings.updateIDs.iotoCssSnippets.baseID,
					tableID: this.settings.updateIDs.iotoCssSnippets.tableID,
					viewID: this.settings.updateIDs.iotoCssSnippets.viewID,
					targetFolderPath: `${this.app.vault.configDir}`,
				}),
				reloadOB: true,
				isPartOfAllUpdates: true,
			},
			{
				id: "get-setting-plugin",
				name: t("Update IOTO Framwork Setting Plugin"),
				tableConfig: () => ({
					baseID: this.settings.updateIDs.iotoSettingPlugin.baseID,
					tableID: this.settings.updateIDs.iotoSettingPlugin.tableID,
					viewID: this.settings.updateIDs.iotoSettingPlugin.viewID,
					targetFolderPath: `${this.app.vault.configDir}`,
				}),
				reloadOB: true,
				isPartOfAllUpdates: true,
			},
			{
				id: "get-user-sync-scripts",
				name: t("Get Your Personal Sync Templates"),
				tableConfig: () => ({
					baseID: this.userSyncSettingAirtableIds?.baseId || "",
					tableID: this.userSyncSettingAirtableIds?.tableId || "",
					viewID: this.userSyncSettingAirtableIds?.viewId || "",
					targetFolderPath: this.settings.userSyncScriptsFolder,
				}),
				iotoUpdate: false,
				filterRecordsByDate: false,
				apiKey: () => this.settings.userAPIKey,
				forceEnSyncFields: true,
			},
		];
	}

	registerCommands() {
		const commandConfigs = this.getCommandConfigs();

		commandConfigs.forEach((config) => {
			this.createNocoDBCommand(
				config.id,
				config.name,
				config.tableConfig(),
				config.reloadOB,
				config.iotoUpdate,
				config.filterRecordsByDate,
				config.apiKey ? config.apiKey() : this.settings.updateAPIKey,
				config.forceEnSyncFields
			);
		});

		this.createRunAllUpdatesCommand(commandConfigs);
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
		this.addCommand({
			id,
			name,
			callback: async () => {
				const templaterTrigerAtCreate =
					this.templaterService.getPluginSetting(
						"trigger_on_file_creation"
					);
				try {
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
				} catch (error) {
					new Notice(error.message);
				} finally {
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
				}
			},
		});
	}

	createRunAllUpdatesCommand(commandConfigs: CommandConfig[]) {
		this.addCommand({
			id: "run-all-updates",
			name: t("Deploy IOTO With One Click"),
			callback: async () => {
				const updateTasks = commandConfigs
					.filter((config) => config.isPartOfAllUpdates)
					.map((config) => ({
						id: config.id,
						name: config.name,
						tableConfig: config.tableConfig(),
					}));

				let successCount = 0;

				const templaterTrigerAtCreate =
					this.templaterService.getPluginSetting(
						"trigger_on_file_creation"
					);
				if (templaterTrigerAtCreate) {
					await this.templaterService.setTemplaterSetting(
						"trigger_on_file_creation",
						false
					);
				}

				for (const task of updateTasks) {
					try {
						new Notice(`${t("Executing")} ${task.name}...`);
						// 优化写法，直接通过对象映射判断是否需要设置 intialSetup
						const needInitialSetupIds = new Set(["get-myioto"]);
						if (needInitialSetupIds.has(task.id)) {
							task.tableConfig.intialSetup = true;
						}
						await this.executeNocoDBCommand(task.tableConfig);
						// // 使用更优雅的方式实现延迟
						// await new Promise(resolve => setTimeout(resolve, 5000));
						new Notice(`${task.name} ${t("completed")}`);
						successCount++;
					} catch (error) {
						new Notice(
							`${task.name} ${t("failed")}: ${error.message}`
						);
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
