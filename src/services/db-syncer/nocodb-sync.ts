import { Notice, normalizePath } from "obsidian";
import { t } from "../../lang/helpers";
import {
	NocoDBTable,
	RecordFields,
	Record,
	DateFilterOption,
} from "../../types";
import { NocoDB } from "./nocodb";
import { DateFilterSuggester } from "../../suggesters/date-filter-suggester";

declare function requestUrl(options: any): Promise<any>;

export class NocoDBSync {
	nocodb: NocoDB;
	app: any;
	vault: any;
	notesToCreate: any[];
	notesToUpdate: any[];
	fetchTitleFrom: string;
	fetchContentFrom: string;
	subFolder: string;
	extension: string;
	updatedIn: string;

	constructor(nocodb: NocoDB, app: any) {
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
		filterRecordsByDate: boolean = false,
	): Promise<any[]> {
		let fields = [
			this.fetchTitleFrom,
			this.fetchContentFrom,
			this.subFolder,
			this.extension,
		];

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
				},
			);
			if (dateFilterOption && dateFilterOption.value !== 99) {
				const formula = `{UpdatedIn} <= ${dateFilterOption.value}`;
				dateFilterFormula = `&filterByFormula=${encodeURIComponent(
					formula,
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
				if (!response.ok && response.status === 401) {
					new Notice(t("API_Token_Invalid"), 2000);
					return [];
				}
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
		filterRecordsByDate: boolean = false,
	): Promise<void> {
		const { vault } = this.app;

		const directoryRootPath = sourceTable.targetFolderPath;

		let notesToCreateOrUpdate: RecordFields[] = (
			await this.fetchRecordsFromSource(sourceTable, filterRecordsByDate)
		).map((note: Record) => note.fields);

		if (sourceTable.intialSetup) {
			// 处理 SubFolder 中的 MyIOTO 格式
			notesToCreateOrUpdate = notesToCreateOrUpdate.map((note) => {
				if (note.SubFolder && note.SubFolder.includes("MyIOTO")) {
					// 使用正则表达式匹配 MyIOTO-数字-数字-数字 的格式并替换为 MyIOTO
					note.SubFolder = note.SubFolder.replace(
						/MyIOTO-\d{1,2}-\d-\d/g,
						"MyIOTO",
					);
				}
				return note;
			});
		}

		new Notice(
			`${t("There are")} ${notesToCreateOrUpdate.length} ${t(
				"files needed to be updated or created.",
			)}`,
		);

		let configDirModified = 0;

		while (notesToCreateOrUpdate.length > 0) {
			let toDealNotes = notesToCreateOrUpdate.slice(0, 10);
			for (let note of toDealNotes) {
				let validFileName = this.convertToValidFileName(
					note.Title || "",
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
						"files needed to be processed.",
					)}`,
				);
			} else {
				new Notice(t("All Finished."));
			}
		}
	}
}
