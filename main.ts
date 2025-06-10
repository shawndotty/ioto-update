import { App, Notice, normalizePath, Plugin, PluginSettingTab, Setting } from 'obsidian';

declare module 'obsidian' {
	interface App {
		plugins: {
			plugins: {
				[key: string]: {
					settings: {
						IOTOFrameworkPath: string;
					};
				};
			};
		};
		commands: {
			executeCommandById: (id: string) => void;
		};
	}
}

// Remember to rename these classes and interfaces!

interface IOTOUpdateSettings {
	updateAPIKey: string;
	updateBaseID: string;
	updateTableID: string;
	updateTables: NocoDBTable[];
}

const DEFAULT_SETTINGS: IOTOUpdateSettings = {
	updateAPIKey: '',
	updateBaseID: 'appq2MtxkPBdZc3Sc',
	updateTableID: 'tbl4GESFGwmmC3b0X',
	updateTables: [],
}

export default class IOTOUpdate extends Plugin {
	settings: IOTOUpdateSettings;
	iotoFrameworkPath: string;

	async onload() {
		await this.loadSettings();
		this.iotoFrameworkPath = this.app.plugins.plugins["ioto-settings"]?.settings?.IOTOFrameworkPath || "";

		// 优化后的 addCommand 方法，减少重复代码，提升可维护性
		const createNocoDBCommand = (
			id: string,
			name: string,
			tableConfig: { viewID: string; targetFolderPath: string; baseID?: string; tableID?: string },
			reloadOB: boolean = false
		) => {
			this.addCommand({
				id,
				name,
				callback: async () => {
					const nocoDBSettings = {
						apiKey: this.settings.updateAPIKey,
						defaultBaseID: this.settings.updateBaseID,
						defaultTableID: this.settings.updateTableID,
						tables: [tableConfig]
					};
					const myNocoDB = new MyNocoDB(nocoDBSettings);
					const nocoDBSync = new NocoDBSync(myNocoDB, this.app);
					const myObsidian = new MyObsidian(this.app, nocoDBSync);
					await myObsidian.onlyFetchFromNocoDB(nocoDBSettings.tables[0]);
					if(reloadOB){
						this.app.commands.executeCommandById("app:reload");
					}
				}
			});
		};

		createNocoDBCommand(
			'ioto-update-core',
			'IOTO Update Core',
			{
				viewID: "viwmC4tRjRsVNlDdM",
				targetFolderPath: this.iotoFrameworkPath
			}
		);

		createNocoDBCommand(
			'ioto-update-help',
			'IOTO Update Help',
			{
				tableID: "tblXcG6xRogRCBtvF",
				viewID: "viwI7YpGWoKyvbqdz",
				targetFolderPath: this.iotoFrameworkPath
			}
		);

		createNocoDBCommand(
			'ioto-update-myioto',
			'IOTO Update MYIOTO',
			{
				viewID: "viwLGvTJb1ody2a4a",
				targetFolderPath: this.iotoFrameworkPath
			}
		);

		createNocoDBCommand(
			'ioto-update-css',
			'IOTO Update CSS',
			{
				viewID: "viw4H3fKTXF4p0OU8",
				targetFolderPath: `${this.app.vault.configDir}`
			},
			true
		);

		createNocoDBCommand(
			'ioto-update-setting-plugin',
			'IOTO Update Setting Plugin',
			{
				viewID: "viw4zaLjEiixIpJpk",
				targetFolderPath: `${this.app.vault.configDir}`
			},
			true
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new IOTOUpdateSettingTab(this.app, this));

	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class IOTOUpdateSettingTab extends PluginSettingTab {
	plugin: IOTOUpdate;

	constructor(app: App, plugin: IOTOUpdate) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Update API Key')
			.setDesc('Please enter your update API Key')
			.addText(text => text
				.setPlaceholder('Enter your update API Key')
				.setValue(this.plugin.settings.updateAPIKey)
				.onChange(async (value) => {
					this.plugin.settings.updateAPIKey = value;
					await this.plugin.saveSettings();
				}));
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
  defaultBaseID?: string;
  baseID?: string;
  defaultTableID?: string;
  tableID?: string;
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
  activeFile: any;
  folder: string;
  nocoDBSyncer: NocoDBSync;

  constructor(app: any, nocoDBSyncer: NocoDBSync) {
    this.app = app;
    this.vault = app.vault;
    this.activeFile = app.workspace.getActiveFile();
    this.folder = this.activeFile.parent.path;
    this.nocoDBSyncer = nocoDBSyncer;
  }

  async onlyFetchFromNocoDB(sourceTable: NocoDBTable): Promise<string | undefined> {

    
	const updateNotice = new Notice(
	this.buildFragment("更新准备中，请稍后……", "#00ff00"),
	0
	);
	const apiKeyValid = await this.nocoDBSyncer.checkApiKey();
	updateNotice.hide();
	if (!apiKeyValid) {
	new Notice(
		this.buildFragment(
		"您的更新API Key已过期，请获取新的API Key。",
		"#ff0000"
		),
		4000
	);
	return;
	}
    
    await this.nocoDBSyncer.createOrUpdateNotesInOBFromSourceTable(sourceTable);

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
  defaultBaseID: string;
  defaultTableID: string;
  tables: NocoDBTable[];
  apiUrlRoot: string;
  apiUrlBase: string;
  apiUrl: string;
  recordUrlBase: string;
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
    this.defaultBaseID = nocoDBSettings.defaultBaseID || nocoDBSettings.baseID || "";
    this.defaultTableID =
      nocoDBSettings.defaultTableID || nocoDBSettings.tableID || "";
    this.tables = nocoDBSettings.tables || [];
    this.apiUrlRoot = "https://api.airtable.com/v0/";
    this.apiUrlBase = this.apiUrlRoot + `${this.defaultBaseID}/`;
    this.apiUrl = this.apiUrlBase + this.defaultTableID;
    this.recordUrlBase = `https://airtable.com/${this.defaultBaseID}/`;
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
    return `${this.apiUrlRoot}${sourceTable.baseID || this.defaultBaseID}/${
      sourceTable.tableID || this.defaultTableID
    }`;
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
            "Authorization": "Bearer " + this.nocodb.apiKey
          }
        });
        // fetch 返回的是 Response 对象，需要调用 .json() 获取数据
        const responseData = await response.json();
        // 为了兼容后续代码，将 responseData 包装成与 requestUrl 返回结构一致
        const responseObj = { json: responseData };

        const data = responseObj.json;
        records = records.concat(data.records);
        new Notice(`已获取${records.length}条数据记录`);

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

  async createOrUpdateNotesInOBFromSourceTable(sourceTable: NocoDBTable): Promise<void> {
    new Notice("数据获取中……");

    const { vault } = this.app;

    const directoryRootPath = sourceTable.targetFolderPath;

    let notesToCreateOrUpdate: RecordFields[] = (await this.fetchRecordsFromSource(sourceTable)).map(
      (note: Record) => note.fields
    );

    new Notice(
      `一共有${notesToCreateOrUpdate.length}个文件需要更新或创建`
    );

    let configDirModified = 0;

    while (notesToCreateOrUpdate.length > 0) {
      let toDealNotes = notesToCreateOrUpdate.slice(0, 10);
      for (let note of toDealNotes) {
        let validFileName = this.convertToValidFileName(note.Title || "");
        let folderPath =
          directoryRootPath + "/" + (note.SubFolder ? note.SubFolder : "");
        await this.createPathIfNeeded(folderPath);
        const noteExtension = "Extension" in note ? note.Extension : "md";
        const notePath = `${folderPath}/${validFileName}.${noteExtension}`;
        const noteExists = await vault.exists(notePath);
        if (!noteExists) {
          await vault.create(notePath, note.MD ? note.MD : "");
        } else if (noteExists && notePath.startsWith(".")) {
          await vault.adapter.write(notePath, note.MD).catch((r: any) => {
            new Notice("文件写入失败: " + r);
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
          `还有${notesToCreateOrUpdate.length}个文件需要处理`
        );
      } else {
        new Notice("全部处理完成");
      }
    }
  }
}