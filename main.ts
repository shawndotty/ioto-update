import {
	App,
	Notice,
	normalizePath,
	Plugin,
	PluginSettingTab,
	FuzzySuggestModal,
	FuzzyMatch,
	Setting,
	moment,
} from "obsidian";
import { t } from "./lang/helpers";

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

interface AirtableIds {
	baseId: string;
	tableId: string;
	viewId: string;
}

interface IOTOUpdateSettings {
	updateAPIKey: string;
	updateAPIKeyIsValid: boolean;
	userEmail: string;
	userChecked: boolean;
	iotoFrameworkPath: string;
	userAPIKey: string;
	userSyncSettingUrl: string;
	userSyncScriptsFolder: string;
	updateIDs: {
		iotoCore: {
			baseID: string;
			tableID: string;
			viewID: string;
		};
		myIotoFull: {
			baseID: string;
			tableID: string;
			viewID: string;
		};
		iotoSettingPlugin: {
			baseID: string;
			tableID: string;
			viewID: string;
		};
		iotoCssSnippets: {
			baseID: string;
			tableID: string;
			viewID: string;
		};
		iotoHelpDocs: {
			baseID: string;
			tableID: string;
			viewID: string;
		};
	};
}

const DEFAULT_SETTINGS: IOTOUpdateSettings = {
	updateAPIKey: "",
	updateAPIKeyIsValid: false,
	userEmail: "",
	iotoFrameworkPath: t("IOTOFrameworPath"),
	userAPIKey: "",
	userSyncSettingUrl: "",
	userSyncScriptsFolder: t("UserSyncTemplatesPath"),
	userChecked: false,
	updateIDs: {
		iotoCore: {
			baseID: "",
			tableID: "",
			viewID: "",
		},
		myIotoFull: {
			baseID: "",
			tableID: "",
			viewID: "",
		},
		iotoSettingPlugin: {
			baseID: "",
			tableID: "",
			viewID: "",
		},
		iotoCssSnippets: {
			baseID: "",
			tableID: "",
			viewID: "",
		},
		iotoHelpDocs: {
			baseID: "",
			tableID: "",
			viewID: "",
		},
	},
};

export default class IOTOUpdate extends Plugin {
	settings: IOTOUpdateSettings;
	userSyncSettingAirtableIds: AirtableIds | null;
	async onload() {
		await this.loadSettings();

		this.userSyncSettingAirtableIds = this.extractAirtableIds(
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
			if(settingName === "trigger_on_file_creation"){
				await templater.event_handler.update_trigger_file_on_creation();
			}
		}
	}

	isValidApiKey(apiKey: string): boolean {
		return Boolean(
			apiKey &&
				apiKey.length >= 82 &&
				apiKey.includes("pat") &&
				apiKey.includes(".")
		);
	}

	isValidEmail(email: string): boolean {
		// 基础格式检查：非空、包含@符号、@后包含点号
		if (
			!email ||
			email.indexOf("@") === -1 ||
			email.indexOf(".", email.indexOf("@")) === -1 ||
			email.length < 10
		) {
			return false;
		}

		// 正则表达式验证（符合RFC 5322标准）
		const emailRegex =
			/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

		return emailRegex.test(email);
	}

	extractAirtableIds(url: string): AirtableIds | null {
		// Regular expression to match Airtable URL pattern
		const regex =
			/https?:\/\/airtable\.com\/(app[^\/]+)\/(tbl[^\/]+)(?:\/(viw[^\/?]+))?/;
		const match = url.match(regex);

		if (!match) {
			return null;
		}

		return {
			baseId: match[1] || "",
			tableId: match[2] || "",
			viewId: match[3] || "",
		};
	}

	async getUpdateIDs() {
		const userEmail = this.settings.userEmail.trim();
		const getUpdateIDsUrl = `https://api.airtable.com/v0/appxQqkHaEkjUQnBf/EmailSync?maxRecords=1&filterByFormula=${encodeURI(
			"{Email} = '" + userEmail + "'"
		)}&fields%5B%5D=IOTOUpdateIDs`;
		const getUpdateIDsToken =
			"patCw7AoXaktNgHNM.bf8eb50a33da820fde56b1f5d4cf5899bc8c508096baf36b700e94cd13570000";

		const response = await requestUrl({
			url: getUpdateIDsUrl,
			method: "GET",
			headers: { Authorization: "Bearer " + getUpdateIDsToken },
		});

		if (
			response.json.records.length &&
			response.json.records[0].fields.IOTOUpdateIDs
		) {
			this.settings.updateIDs = JSON.parse(
				response.json.records[0].fields.IOTOUpdateIDs.first()
			);
			this.settings.userChecked = true;
		} else {
			this.settings.updateIDs = DEFAULT_SETTINGS.updateIDs;
			this.settings.userChecked = DEFAULT_SETTINGS.userChecked;
		}

		await this.saveSettings();
	}

	async checkApiKey() {
		const updateUUID = crypto.randomUUID();
		const checkApiWebHookUrl =
			"https://hooks.airtable.com/workflows/v1/genericWebhook/appq9k6KwHV3lEIJZ/wfl2uT25IPEljno9w/wtrFUIEC8SXlDsdIu";
		const checkApiValidUrl = `https://api.airtable.com/v0/appq9k6KwHV3lEIJZ/UpdateLogs?maxRecords=1&view=viweTQ2YarquoqZUT&filterByFormula=${encodeURI(
			"{UUID} = '" + updateUUID + "'"
		)}&fields%5B%5D=Match`;
		const checkApiValidToken =
			"patCw7AoXaktNgHNM.bf8eb50a33da820fde56b1f5d4cf5899bc8c508096baf36b700e94cd13570000";
		let validKey = 0;
		try {
			await requestUrl({
				url: checkApiWebHookUrl,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					uuid: updateUUID,
					userApiKey: this.settings.updateAPIKey,
				}),
			});

			await new Promise((r) => setTimeout(r, 1500));

			try {
				const matchRes = await requestUrl({
					url: checkApiValidUrl,
					method: "GET",
					headers: { Authorization: "Bearer " + checkApiValidToken },
				});
				validKey = matchRes.json.records[0].fields.Match;
			} catch (error) {
				console.log(error);
			}
		} catch (error) {
			console.log(error);
		}

		if (validKey) {
			this.settings.updateAPIKeyIsValid = true;
		} else {
			this.settings.updateAPIKeyIsValid = false;
		}

		await this.saveSettings();
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
		const fieldNames = this.buildFieldNames(forceDefaultFetchFields);
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

	buildFieldNames(forceDefaultFetchFields: boolean = false) {
		const local = moment.locale();
		if (forceDefaultFetchFields) {
			return {
				title: "Title",
				subFolder: "SubFolder",
				content: "MD",
			};
		}
		const fieldNames = {
			zhCN: {
				title: "Title",
				subFolder: "SubFolder",
				content: "MD",
			},
			en: {
				title: "TitleEN",
				subFolder: "SubFolderEN",
				content: "MDEN",
			},
			zhTW: {
				title: "TitleTW",
				subFolder: "SubFolderTW",
				content: "MDTW",
			},
		};
		switch (local) {
			case "zh-cn":
				return fieldNames.zhCN;
			case "en":
				return fieldNames.en;
			case "zh-tw":
				return fieldNames.zhTW;
			default:
				return fieldNames.en;
		}
	}
}

class IOTOUpdateSettingTab extends PluginSettingTab {
	plugin: IOTOUpdate;

	constructor(app: App, plugin: IOTOUpdate) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: t("IOTO Update Settings"),
			cls: "my-plugin-title", // 添加自定义CSS类
		});

		new Setting(containerEl)
			.setName(t("Your Update API Key"))
			.setDesc(t("Please enter your update API Key"))
			.addText((text) => {
				const validSpan = createEl("span", {
					text: t("Valid API Key"),
					cls: "valid-text",
				});
				const loadingSpan = createEl("span", {
					text: t("Validating..."),
					cls: "loading-text",
				});
				validSpan.style.display = "none";
				loadingSpan.style.display = "none";
				text.inputEl.parentElement?.insertBefore(
					validSpan,
					text.inputEl
				);
				text.inputEl.parentElement?.insertBefore(
					loadingSpan,
					text.inputEl
				);

				const updateValidState = (
					isValid: boolean,
					isLoading: boolean = false
				) => {
					if (isLoading) {
						text.inputEl.removeClass("valid-api-key");
						text.inputEl.removeClass("invalid-api-key");
						validSpan.style.display = "none";
						loadingSpan.style.display = "inline";
					} else {
						loadingSpan.style.display = "none";
						if (isValid) {
							text.inputEl.removeClass("invalid-api-key");
							text.inputEl.addClass("valid-api-key");
							text.inputEl.style.borderColor = "#4CAF50";
							text.inputEl.style.color = "#4CAF50";
							validSpan.style.display = "inline";
						} else {
							text.inputEl.removeClass("valid-api-key");
							text.inputEl.addClass("invalid-api-key");
							text.inputEl.style.borderColor = "#FF5252";
							text.inputEl.style.color = "#FF5252";
							validSpan.style.display = "none";
						}
					}
				};

				// 初始状态设置
				updateValidState(this.plugin.settings.updateAPIKeyIsValid);

				return text
					.setPlaceholder(t("Enter your update API Key"))
					.setValue(this.plugin.settings.updateAPIKey)
					.onChange(async (value) => {
						this.plugin.settings.updateAPIKey = value;
						if (this.plugin.isValidApiKey(value)) {
							updateValidState(false, true); // 显示加载状态
							await this.plugin.checkApiKey();
							updateValidState(
								this.plugin.settings.updateAPIKeyIsValid
							);
						} else {
							updateValidState(false);
						}
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("Your Email Address"))
			.setDesc(
				t(
					"Please enter the email you provided when you purchase this product"
				)
			)
			.addText((text) => {
				const validSpan = createEl("span", {
					text: t("Valid Email"),
					cls: "valid-text",
				});
				const loadingSpan = createEl("span", {
					text: t("Validating..."),
					cls: "loading-text",
				});
				validSpan.style.display = "none";
				loadingSpan.style.display = "none";
				text.inputEl.parentElement?.insertBefore(
					validSpan,
					text.inputEl
				);
				text.inputEl.parentElement?.insertBefore(
					loadingSpan,
					text.inputEl
				);

				const updateValidState = (
					isValid: boolean,
					isLoading: boolean = false
				) => {
					if (isLoading) {
						text.inputEl.removeClass("valid-email");
						text.inputEl.removeClass("invalid-email");
						validSpan.style.display = "none";
						loadingSpan.style.display = "inline";
					} else {
						loadingSpan.style.display = "none";
						if (isValid) {
							text.inputEl.removeClass("invalid-email");
							text.inputEl.addClass("valid-email");
							text.inputEl.style.borderColor = "#4CAF50";
							text.inputEl.style.color = "#4CAF50";
							validSpan.style.display = "inline";
						} else {
							text.inputEl.removeClass("valid-email");
							text.inputEl.addClass("invalid-email");
							text.inputEl.style.borderColor = "#FF5252";
							text.inputEl.style.color = "#FF5252";
							validSpan.style.display = "none";
						}
					}
				};

				// 初始状态设置
				updateValidState(this.plugin.settings.userChecked);

				return text
					.setPlaceholder(t("Enter your email"))
					.setValue(this.plugin.settings.userEmail)
					.onChange(async (value) => {
						this.plugin.settings.userEmail = value;
						if (
							this.plugin.isValidEmail(
								this.plugin.settings.userEmail
							)
						) {
							updateValidState(false, true); // 显示加载状态

							await this.plugin.getUpdateIDs();

							updateValidState(this.plugin.settings.userChecked);
						} else {
							updateValidState(false);
						}
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("IOTO Framework Path"))
			.setDesc(t("Please enter the path to your IOTO Framework"))
			.addText((text) =>
				text
					.setPlaceholder(t("Enter the path to your IOTO Framework"))
					.setValue(this.plugin.settings.iotoFrameworkPath)
					.onChange(async (value) => {
						this.plugin.settings.iotoFrameworkPath = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h2", {
			text: t("User Sync Configration Update Settings"),
			cls: "my-plugin-title", // 添加自定义CSS类
		});

		new Setting(containerEl)
			.setName(t("Your Airtable Personal Token"))
			.setDesc(t("Please enter your Airtable Personal Token"))
			.addText((text) =>
				text
					.setPlaceholder(t("Enter your Airtable Personal Token"))
					.setValue(this.plugin.settings.userAPIKey)
					.onChange(async (value) => {
						this.plugin.settings.userAPIKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("Your Sync Setting URL"))
			.setDesc(t("Please enter the url of your sync setting table"))
			.addText((text) =>
				text
					.setPlaceholder(t("Enter the url"))
					.setValue(this.plugin.settings.userSyncSettingUrl)
					.onChange(async (value) => {
						this.plugin.settings.userSyncSettingUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("Your Sync Templates Folder"))
			.setDesc(t("Please enter the path to your sync templates folder"))
			.addText((text) =>
				text
					.setPlaceholder(
						t("Enter the path to your sync templates folder")
					)
					.setValue(this.plugin.settings.userSyncScriptsFolder)
					.onChange(async (value) => {
						this.plugin.settings.userSyncScriptsFolder = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("hr");

		const infoContainer = containerEl.createDiv();

		infoContainer.createEl("p", {
			text: t(
				"When you use the sync with online database feature of IOTO, the sync configration generater I built could help you a lot."
			),
		});

		infoContainer.createEl("p", {
			text: t(
				"You can use the following link to open the shared base and save it to your own Airtable workspace."
			),
		});

		const baseLink = infoContainer.createEl("a", {
			text: t("Sync Configration Generator"),
			href: "https://airtable.com/appekNvvdLY7J8zsq/shrpqtEGVjz8bgw9N",
		});
		baseLink.setAttr("target", "_blank");
		baseLink.setAttr("rel", "noopener noreferrer");

		infoContainer.createEl("p", {
			text: t(
				"In order to help you to learn how to use IOTO especially the sync with online database feature, I will keep posting instructions and videos to the following link."
			),
		});

		const deomLink = infoContainer.createEl("a", {
			text: t("IOTO How To Guide"),
			href: "https://airtable.com/appKL3zMp0cOYFdJk/shrbQQvVwAMI4sI0Y",
		});

		deomLink.setAttr("target", "_blank");
		deomLink.setAttr("rel", "noopener noreferrer");
	}
}

// 类型定义
interface NocoDBTable {
	viewID: string;
	baseID?: string;
	tableID?: string;
	targetFolderPath: string;
	intialSetup?: boolean;
}

interface NocoDBSettings {
	apiKey: string;
	tables?: NocoDBTable[];
	iotoUpdate?: boolean;
	syncSettings?: {
		recordFieldsNames?: {
			title?: string;
			content?: string;
			subFolder?: string;
			extension?: string;
			updatedIn?: string;
		};
	};
}

interface RecordFields {
	[key: string]: any;
	Title?: string;
	TitleEN?: string;
	TitleTW?: string;
	MD?: string;
	MDEN?: string;
	MDTW?: string;
	SubFolder?: string;
	SubFolderEN?: string;
	SubFolderTW?: string;
	Extension?: string;
	UpdatedIn?: number;
}

interface Record {
	fields: RecordFields;
}

declare function requestUrl(options: any): Promise<any>;

class MyObsidian {
	app: any;
	vault: any;
	nocoDBSyncer: NocoDBSync;

	constructor(app: any, nocoDBSyncer: NocoDBSync) {
		this.app = app;
		this.vault = app.vault;
		this.nocoDBSyncer = nocoDBSyncer;
	}

	async onlyFetchFromNocoDB(
		sourceTable: NocoDBTable,
		iotoUpdate: boolean = true,
		updateAPIKeyIsValid: boolean = false,
		filterRecordsByDate: boolean = false
	): Promise<string | undefined> {
		if (iotoUpdate) {
			if (!updateAPIKeyIsValid) {
				new Notice(
					this.buildFragment(
						t("Your API Key was expired. Please get a new one."),
						"#ff0000"
					),
					4000
				);
				return;
			}
		}

		await this.nocoDBSyncer.createOrUpdateNotesInOBFromSourceTable(
			sourceTable,
			filterRecordsByDate
		);
	}

	/**
	 * 创建一个带有指定文本内容和颜色的文档片段
	 * @param {string} content - 要显示的文本内容
	 * @param {string} color - 文本颜色，支持CSS颜色值（如'#ff0000'、'red'等）
	 * @returns {DocumentFragment} 返回包含样式化文本的文档片段
	 */
	buildFragment(content: string, color: string): DocumentFragment {
		const fragment = document.createDocumentFragment();
		const div = document.createElement("div");
		div.textContent = content;
		div.style.color = color;
		fragment.appendChild(div);
		return fragment;
	}
}

class MyNocoDB {
	apiKey: string;
	tables: NocoDBTable[];
	apiUrlRoot: string;
	iotoUpdate: boolean;
	recordFieldsNames: {
		title: string;
		content: string;
		subFolder: string;
		extension: string;
		updatedIn: string;
		[key: string]: string;
	};

	constructor(nocoDBSettings: NocoDBSettings) {
		this.apiKey = nocoDBSettings.apiKey;
		this.tables = nocoDBSettings.tables || [];
		this.apiUrlRoot = "https://api.airtable.com/v0/";
		this.iotoUpdate = nocoDBSettings.iotoUpdate || false;
		this.recordFieldsNames = {
			...{
				title: "Title",
				content: "MD",
				subFolder: "SubFolder",
				extension: "Extension",
				updatedIn: "UpdatedIn",
			},
			...(nocoDBSettings.syncSettings?.recordFieldsNames || {}),
		};
	}

	makeApiUrl(sourceTable: NocoDBTable): string {
		return `${this.apiUrlRoot}${sourceTable.baseID}/${sourceTable.tableID}`;
	}
}

class NocoDBSync {
	nocodb: MyNocoDB;
	app: any;
	vault: any;
	notesToCreate: any[];
	notesToUpdate: any[];
	fetchTitleFrom: string;
	fetchContentFrom: string;
	subFolder: string;
	extension: string;
	updatedIn: string;

	constructor(nocodb: MyNocoDB, app: any) {
		this.nocodb = nocodb;
		this.app = app;
		this.vault = app.vault;
		this.notesToCreate = [];
		this.notesToUpdate = [];
		this.fetchTitleFrom = this.nocodb.recordFieldsNames.title;
		this.fetchContentFrom = this.nocodb.recordFieldsNames.content;
		this.subFolder = this.nocodb.recordFieldsNames.subFolder;
		this.extension = this.nocodb.recordFieldsNames.extension;
		this.updatedIn = this.nocodb.recordFieldsNames.updatedIn;
	}

	getFetchSourceTable(sourceViewID: string): NocoDBTable | undefined {
		// @ts-ignore
		return this.nocodb.tables
			.filter((table) => sourceViewID == table.viewID)
			.first();
	}

	async fetchRecordsFromSource(
		sourceTable: NocoDBTable,
		filterRecordsByDate: boolean = false
	): Promise<any[]> {
		let fields = [
			this.fetchTitleFrom,
			this.fetchContentFrom,
			this.subFolder,
			this.extension,
		];
		console.dir(fields);
		let dateFilterOption: DateFilterOption | null = null;
		let dateFilterFormula = "";
		if (filterRecordsByDate) {
			fields.push(this.updatedIn);
			const suggester = new DateFilterSuggester(this.app);
			dateFilterOption = await new Promise<DateFilterOption>(
				(resolve) => {
					suggester.onChooseItem = (item) => {
						resolve(item);
						return item;
					};
					suggester.open();
				}
			);
			if (dateFilterOption && dateFilterOption.value !== 99) {
				const formula = `{UpdatedIn} <= ${dateFilterOption.value}`;
				dateFilterFormula = `&filterByFormula=${encodeURIComponent(
					formula
				)}`;
			}
		}
		let url = `${this.nocodb.makeApiUrl(sourceTable)}?view=${
			sourceTable.viewID
		}
		&
		${fields.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join("&")}
			${dateFilterFormula}
			&offset=`;
		new Notice(t("Getting Data ……"));
		let records = await this.getAllRecordsFromTable(url);

		if (!records || records.length === 0) {
			//new Notice(t("No records found"));
			return [];
		}
		// 将 records 中的 fields 映射到 mappedRecords 中
		const mappedRecords = records.map((record) => {
			const fields = record.fields;
			const mappedFields: any = {};

			for (const key in fields) {
				if (key.includes("Title")) {
					mappedFields.Title = fields[key];
				} else if (key.includes("SubFolder")) {
					mappedFields.SubFolder = fields[key];
				} else if (key.includes("MD")) {
					mappedFields.MD = fields[key];
				} else {
					mappedFields[key] = fields[key];
				}
			}

			record.fields = mappedFields;

			return record;
		});

		return mappedRecords;
	}

	async getAllRecordsFromTable(url: string): Promise<any[]> {
		let records: any[] = [];
		let offset = "";

		do {
			try {
				// 使用 fetch 替换 requestUrl
				const response = await fetch(url + offset, {
					method: "GET",
					headers: {
						Authorization: "Bearer " + this.nocodb.apiKey,
					},
				});
				// fetch 返回的是 Response 对象，需要调用 .json() 获取数据
				const responseData = await response.json();
				// 为了兼容后续代码，将 responseData 包装成与 requestUrl 返回结构一致
				const responseObj = { json: responseData };

				const data = responseObj.json;
				records = records.concat(data.records);
				new Notice(`${t("Got")} ${records.length} ${t("records")}`);

				offset = data.offset || "";
			} catch (error) {
				console.dir(error);
			}
		} while (offset !== "");

		return records;
	}

	convertToValidFileName(fileName: string): string {
		return fileName.replace(/[\/|\\:'"()（）{}<>\.\*]/g, "-").trim();
	}

	async createPathIfNeeded(folderPath: string): Promise<void> {
		const { vault } = this.app;
		const directoryExists = await vault.exists(folderPath);
		if (!directoryExists) {
			await vault.createFolder(normalizePath(folderPath));
		}
	}

	async createOrUpdateNotesInOBFromSourceTable(
		sourceTable: NocoDBTable,
		filterRecordsByDate: boolean = false
	): Promise<void> {
		const { vault } = this.app;

		const directoryRootPath = sourceTable.targetFolderPath;

		let notesToCreateOrUpdate: RecordFields[] = (
			await this.fetchRecordsFromSource(sourceTable, filterRecordsByDate)
		).map((note: Record) => note.fields);

		console.dir(notesToCreateOrUpdate);

		if (sourceTable.intialSetup) {
			// 处理 SubFolder 中的 MyIOTO 格式
			notesToCreateOrUpdate = notesToCreateOrUpdate.map((note) => {
				if (note.SubFolder && note.SubFolder.includes("MyIOTO")) {
					// 使用正则表达式匹配 MyIOTO-数字-数字-数字 的格式并替换为 MyIOTO
					note.SubFolder = note.SubFolder.replace(
						/MyIOTO-\d{1,2}-\d-\d/g,
						"MyIOTO"
					);
				}
				return note;
			});
		}

		new Notice(
			`${t("There are")} ${notesToCreateOrUpdate.length} ${t(
				"files needed to be updated or created."
			)}`
		);

		let configDirModified = 0;

		while (notesToCreateOrUpdate.length > 0) {
			let toDealNotes = notesToCreateOrUpdate.slice(0, 10);
			for (let note of toDealNotes) {
				let validFileName = this.convertToValidFileName(
					note.Title || ""
				);
				let folderPath =
					directoryRootPath +
					(note.SubFolder ? `/${note.SubFolder}` : "");
				await this.createPathIfNeeded(folderPath);
				const noteExtension =
					"Extension" in note ? note.Extension : "md";
				const notePath = `${folderPath}/${validFileName}.${noteExtension}`;
				const noteExists = await vault.exists(notePath);
				let noteContent = note.MD ? note.MD : "";
				if (!noteExists) {
					await vault.create(notePath, noteContent);
				} else if (noteExists && notePath.startsWith(".")) {
					await vault.adapter
						.write(notePath, noteContent)
						.catch((r: any) => {
							new Notice(t("Failed to write file: ") + r);
						});
					configDirModified++;
				} else {
					let file = this.app.vault.getFileByPath(notePath);
					await vault.modify(file, noteContent);
					await new Promise((r) => setTimeout(r, 100)); // 等待元数据更新
				}
			}

			notesToCreateOrUpdate = notesToCreateOrUpdate.slice(10);
			if (notesToCreateOrUpdate.length) {
				new Notice(
					`${t("There are")} ${notesToCreateOrUpdate.length} ${t(
						"files needed to be processed."
					)}`
				);
			} else {
				new Notice(t("All Finished."));
			}
		}
	}
}

// 定义选项接口
interface DateFilterOption {
	id: string;
	name: string;
	value: number;
}

class DateFilterSuggester extends FuzzySuggestModal<DateFilterOption> {
	private options: DateFilterOption[] = [
		{ id: "day", name: t("Help documents updated today"), value: 1 },
		{
			id: "week",
			name: t("Help documents updated in the past week"),
			value: 7,
		},
		{
			id: "twoWeeks",
			name: t("Help documents updated in the past two weeks"),
			value: 14,
		},
		{
			id: "month",
			name: t("Help documents updated in the past month"),
			value: 30,
		},
		{ id: "all", name: t("All help documents"), value: 99 },
	];

	getItems(): DateFilterOption[] {
		return this.options;
	}

	getItemText(item: DateFilterOption): string {
		return item.name;
	}

	onChooseItem(
		item: DateFilterOption,
		evt: MouseEvent | KeyboardEvent
	): DateFilterOption {
		return item;
	}

	renderSuggestion(
		item: FuzzyMatch<DateFilterOption>,
		el: HTMLElement
	): void {
		el.createEl("div", { text: item.item.name, cls: "suggester-title" });
	}
}
