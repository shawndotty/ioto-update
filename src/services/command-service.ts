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
import { ApiService } from "./api-service";
import { GithubService } from "./github-service";

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
	private plugin: any;
	private addCommand: (command: Command) => void;
	private settings: IOTOUpdateSettings;
	private templaterService: TemplaterService;
	private userSyncSettingAirtableIds: AirtableIds | null;
	private apiService: ApiService;

	constructor(
		app: App,
		plugin: any,
		addCommand: (command: Command) => void,
		settings: IOTOUpdateSettings,
		templaterService: TemplaterService,
		apiService: ApiService,
	) {
		this.app = app;
		this.plugin = plugin;
		this.addCommand = addCommand;
		this.settings = settings;
		this.templaterService = templaterService;
		this.apiService = apiService;
		this.userSyncSettingAirtableIds = Utils.extractAirtableIds(
			this.settings.userSyncSettingUrl,
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
		if (
			this.settings.userChecked &&
			this.settings.updateAPIKeyIsValid &&
			Utils.isValidApiKey(this.settings.updateAPIKey) &&
			Utils.isValidEmail(this.settings.userEmail)
		) {
			const commandConfigs = this.getCommandConfigs();

			commandConfigs.forEach((config) => {
				this.createNocoDBCommand(
					config.id,
					config.name,
					config.tableConfig(),
					config.reloadOB,
					config.iotoUpdate,
					config.filterRecordsByDate,
					config.apiKey
						? config.apiKey()
						: this.settings.updateAPIKey,
					config.forceEnSyncFields,
				);
			});

			this.createRunAllUpdatesCommand(commandConfigs);

			this.addCommand({
				id: "update-user-permissions",
				name: t("Update User Permissions"),
				callback: async () => {
					new Notice(t("Updating User Permissions ..."));
					await this.executeWithReload(async () => {
						await this.apiService.getUpdateIDs();
						await this.plugin.saveSettings();
					});
					if (this.settings.userChecked) {
						new Notice(t("Update User Permissions Success"));
					} else {
						new Notice(t("Update User Permissions Failed"));
					}
				},
			});

			if (
				["viwZvtQy1GDWu00sA", "viwwopZSx1IGoTiJE"].includes(
					this.plugin.settings.updateIDs.iotoSettingPlugin?.viewID,
				)
			) {
				this.addCommand({
					id: "install-ssg-from-github",
					name:
						t("Install Sync Scripts Generator") +
						t("PluginIndicator"),
					callback: async () => {
						await GithubService.installPluginFrom(
							this.app,
							"https://github.com/shawndotty/sync-script-generator",
						);
					},
				});
			}

			this.addCommand({
				id: "install-itg-from-github",
				name:
					t("Install IOTO Template Generator") + t("PluginIndicator"),
				icon: "puzzle", // 使用 lucide 的 puzzle 图标代表插件
				callback: async () => {
					await GithubService.installPluginFrom(
						this.app,
						"https://github.com/shawndotty/ioto-template-generator",
					);
				},
			});

			this.addCommand({
				id: "install-ioto-dashboard-from-github",
				name: t("Install IOTO Dashboard") + t("PluginIndicator"),
				callback: async () => {
					await GithubService.installPluginFrom(
						this.app,
						"https://github.com/shawndotty/ioto-dashboard",
					);
				},
			});
		}
	}

	async executeNocoDBCommand(
		tableConfig: NocoDBTable,
		iotoUpdate: boolean = true,
		filterRecordsByDate: boolean = false,
		apiKey: string = this.settings.updateAPIKey,
		forceDefaultFetchFields: boolean = false,
	) {
		const fieldNames = Utils.buildFieldNames(
			forceDefaultFetchFields,
			this.settings.iotoRunningLanguage,
		);
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
			filterRecordsByDate,
		);
	}

	private async withDisabledTemplaterTrigger(
		action: () => Promise<void>,
	): Promise<void> {
		const templaterTrigerAtCreate = this.templaterService.getPluginSetting(
			"trigger_on_file_creation",
		);
		try {
			if (templaterTrigerAtCreate) {
				await this.templaterService.setTemplaterSetting(
					"trigger_on_file_creation",
					false,
				);
			}
			await action();
		} finally {
			if (templaterTrigerAtCreate) {
				await this.templaterService.setTemplaterSetting(
					"trigger_on_file_creation",
					true,
				);
			}
		}
	}

	createNocoDBCommand(
		id: string,
		name: string,
		tableConfig: NocoDBTable,
		reloadOB: boolean = false,
		iotoUpdate: boolean = true,
		filterRecordsByDate: boolean = false,
		apiKey: string = this.settings.updateAPIKey,
		forceEnSyncFields: boolean = false,
	) {
		this.addCommand({
			id,
			name,
			callback: async () => {
				try {
					await this.withDisabledTemplaterTrigger(async () => {
						await this.executeNocoDBCommand(
							tableConfig,
							iotoUpdate,
							filterRecordsByDate,
							apiKey,
							forceEnSyncFields,
						);
					});
				} catch (error) {
					new Notice(error.message);
				} finally {
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

				await this.withDisabledTemplaterTrigger(async () => {
					const updatePromises = updateTasks.map((task) => {
						return (async () => {
							try {
								new Notice(`${t("Executing")} ${task.name}...`);
								// 优化写法，直接通过对象映射判断是否需要设置 intialSetup
								const needInitialSetupIds = new Set([
									"get-myioto",
								]);
								if (needInitialSetupIds.has(task.id)) {
									task.tableConfig.intialSetup = true;
								}
								await this.executeNocoDBCommand(
									task.tableConfig,
								);
								new Notice(`${task.name} ${t("completed")}`);
								return {
									status: "fulfilled",
									name: task.name,
								};
							} catch (error) {
								new Notice(
									`${task.name} ${t("failed")}: ${
										error.message
									}`,
								);
								return {
									status: "rejected",
									name: task.name,
									reason: error,
								};
							}
						})();
					});

					const results = await Promise.allSettled(updatePromises);
					const successfulUpdates = results.filter(
						(r) => r.status === "fulfilled",
					).length;

					if (successfulUpdates === updateTasks.length) {
						this.app.commands.executeCommandById("app:reload");
					}
				});
			},
		});
	}

	private async executeWithReload(
		callback: () => Promise<void>,
	): Promise<void> {
		await callback();
		setTimeout(() => {
			this.app.commands.executeCommandById("app:reload");
		}, 1000);
	}
}
