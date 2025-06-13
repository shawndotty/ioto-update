import {
	App,
	Notice,
	normalizePath,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import { t } from "./lang/helpers";

// 扩展 App 类型以包含 commands 属性
declare module "obsidian" {
	interface App {
		commands: {
			executeCommandById(id: string): void;
		};
	}
}

interface AirtableIds {
	baseId: string;
	tableId: string;
	viewId: string;
}
// Remember to rename these classes and interfaces!

interface IOTOUpdateSettings {
	updateAPIKey: string;
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
	userEmail: "",
	iotoFrameworkPath: "0-辅助/IOTO",
	userAPIKey: "",
	userSyncSettingUrl: "",
	userSyncScriptsFolder: "0-辅助/IOTO/Templates/Templater/MyIOTO/同步模板",
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

		// 优化后的 addCommand 方法，减少重复代码，提升可维护性
		const createNocoDBCommand = (
			id: string,
			name: string,
			tableConfig: {
				viewID: string;
				targetFolderPath: string;
				baseID?: string;
				tableID?: string;
			},
			reloadOB: boolean = false,
			iotoUpdate: boolean = true,
			apiKey: string = this.settings.updateAPIKey
		) => {
			this.addCommand({
				id,
				name,
				callback: async () => {
					if (iotoUpdate) {
						if (!this.settings.updateAPIKey) {
							new Notice(
								t(
									"You must provide an API Key to run this command"
								)
							);
							return;
						}
						if (!this.settings.userEmail) {
							new Notice(
								t(
									"You need to provide the email for your account to run this command"
								)
							);
							return;
						}
					} else {
						if (!this.settings.userAPIKey) {
							new Notice(
								t(
									"You must provide an API Key to run this command"
								)
							);
							return;
						}

						if (!this.settings.userSyncSettingUrl) {
							new Notice(
								t(
									"You need to provide the airtable url for your sync setting table to run this command"
								)
							);
							return;
						}
					}

					const nocoDBSettings = {
						apiKey: apiKey,
						tables: [tableConfig],
					};
					const myNocoDB = new MyNocoDB(nocoDBSettings);
					const nocoDBSync = new NocoDBSync(myNocoDB, this.app);
					const myObsidian = new MyObsidian(this.app, nocoDBSync);
					await myObsidian.onlyFetchFromNocoDB(
						nocoDBSettings.tables[0],
						iotoUpdate
					);
					if (reloadOB) {
						this.app.commands.executeCommandById("app:reload");
					}
				},
			});
		};

		createNocoDBCommand("ioto-update-core", t("Update Core Files"), {
			baseID: this.settings.updateIDs.iotoCore.baseID,
			tableID: this.settings.updateIDs.iotoCore.tableID,
			viewID: this.settings.updateIDs.iotoCore.viewID,
			targetFolderPath: this.settings.iotoFrameworkPath,
		});

		createNocoDBCommand("ioto-update-help", t("Update Help Docs"), {
			baseID: this.settings.updateIDs.iotoHelpDocs.baseID,
			tableID: this.settings.updateIDs.iotoHelpDocs.tableID,
			viewID: this.settings.updateIDs.iotoHelpDocs.viewID,
			targetFolderPath: this.settings.iotoFrameworkPath,
		});

		createNocoDBCommand(
			"ioto-update-myioto",
			t("Update MYIOTO Templates"),
			{
				baseID: this.settings.updateIDs.myIotoFull.baseID,
				tableID: this.settings.updateIDs.myIotoFull.tableID,
				viewID: this.settings.updateIDs.myIotoFull.viewID,
				targetFolderPath: this.settings.iotoFrameworkPath,
			}
		);

		createNocoDBCommand(
			"ioto-update-css",
			t("Update CSS Snippets"),
			{
				baseID: this.settings.updateIDs.iotoCssSnippets.baseID,
				tableID: this.settings.updateIDs.iotoCssSnippets.tableID,
				viewID: this.settings.updateIDs.iotoCssSnippets.viewID,
				targetFolderPath: `${this.app.vault.configDir}`,
			},
			true
		);

		createNocoDBCommand(
			"ioto-update-setting-plugin",
			t("Update IOTO Framwork Setting Plugin"),
			{
				baseID: this.settings.updateIDs.iotoSettingPlugin.baseID,
				tableID: this.settings.updateIDs.iotoSettingPlugin.tableID,
				viewID: this.settings.updateIDs.iotoSettingPlugin.viewID,
				targetFolderPath: `${this.app.vault.configDir}`,
			},
			true
		);

		createNocoDBCommand(
			"ioto-update-get-user-sync-scripts",
			t("Get Your Personal Sync Templates"),
			{
				baseID: this.userSyncSettingAirtableIds?.baseId || "",
				tableID: this.userSyncSettingAirtableIds?.tableId || "",
				viewID: this.userSyncSettingAirtableIds?.viewId || "",
				targetFolderPath: this.settings.userSyncScriptsFolder,
			},
			false,
			false,
			this.settings.userAPIKey
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new IOTOUpdateSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	isValidEmail(email: string): boolean {
		// 基础格式检查：非空、包含@符号、@后包含点号
		if (
			!email ||
			email.indexOf("@") === -1 ||
			email.indexOf(".", email.indexOf("@")) === -1
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
		const getUpdateIDsUrl = `https://api.airtable.com/v0/appxQqkHaEkjUQnBf/EmailSync?maxRecords=3&view=Grid%20view&filterByFormula=${encodeURI(
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
			console.log("done");
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
			.addText((text) =>
				text
					.setPlaceholder(t("Enter your update API Key"))
					.setValue(this.plugin.settings.updateAPIKey)
					.onChange(async (value) => {
						this.plugin.settings.updateAPIKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("Your Email Address"))
			.setDesc(
				t("Please enter your Email when you purchase this product")
			)
			.addText((text) =>
				text
					.setPlaceholder(t("Enter your email"))
					.setValue(this.plugin.settings.userEmail)
					.onChange(async (value) => {
						this.plugin.settings.userEmail = value;
						if (
							this.plugin.isValidEmail(
								this.plugin.settings.userEmail
							)
						) {
							await this.plugin.getUpdateIDs();
						}
						await this.plugin.saveSettings();
					})
			);

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
			text: t("User Sync Scripts Update Settings"),
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

		containerEl.createEl("p", {
			text: t(
				"You need to provide the airtable url for your sync setting table to run this command"
			),
			cls: "my-plugin-desc", // 添加自定义CSS类
		});
	}
}

// 类型定义
interface NocoDBTable {
	viewID: string;
	baseID?: string;
	tableID?: string;
	targetFolderPath: string;
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
		};
	};
}

interface RecordFields {
	[key: string]: any;
	Title?: string;
	MD?: string;
	SubFolder?: string;
	Extension?: string;
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
		iotoUpdate: boolean = true
	): Promise<string | undefined> {
		if (iotoUpdate) {
			const updateNotice = new Notice(
				this.buildFragment(
					t("Updating, plese wait for a moment"),
					"#00ff00"
				),
				0
			);
			const apiKeyValid = await this.nocoDBSyncer.checkApiKey();
			updateNotice.hide();
			if (!apiKeyValid) {
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
			sourceTable
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
	}

	getFetchSourceTable(sourceViewID: string): NocoDBTable | undefined {
		// @ts-ignore
		return this.nocodb.tables
			.filter((table) => sourceViewID == table.viewID)
			.first();
	}

	async fetchRecordsFromSource(sourceTable: NocoDBTable): Promise<any[]> {
		const fields = [
			this.fetchTitleFrom,
			this.fetchContentFrom,
			this.subFolder,
			this.extension,
		];
		let url = `${this.nocodb.makeApiUrl(sourceTable)}?view=${
			sourceTable.viewID
		}&${fields
			.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`)
			.join("&")}&offset=`;

		let records = await this.getAllRecordsFromTable(url);

		return records;
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

	async checkApiKey(): Promise<number> {
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
			const res = await requestUrl({
				url: checkApiWebHookUrl,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					uuid: updateUUID,
					userApiKey: this.nocodb.apiKey,
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

		return validKey;
	}

	async createOrUpdateNotesInOBFromSourceTable(
		sourceTable: NocoDBTable
	): Promise<void> {
		new Notice(t("Getting Data ……"));

		const { vault } = this.app;

		const directoryRootPath = sourceTable.targetFolderPath;

		let notesToCreateOrUpdate: RecordFields[] = (
			await this.fetchRecordsFromSource(sourceTable)
		).map((note: Record) => note.fields);

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
				if (!noteExists) {
					await vault.create(notePath, note.MD ? note.MD : "");
				} else if (noteExists && notePath.startsWith(".")) {
					await vault.adapter
						.write(notePath, note.MD)
						.catch((r: any) => {
							new Notice(t("Failed to write file: ") + r);
						});
					configDirModified++;
				} else {
					let file = this.app.vault.getFileByPath(notePath);
					await vault.modify(file, note.MD ? note.MD : "");
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
