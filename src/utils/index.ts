import {
	App,
	normalizePath,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
	moment,
} from "obsidian";
import { AirtableIds } from "../types";

export class Utils {
	static isValidApiKey(apiKey: string): boolean {
		return Boolean(
			apiKey &&
				apiKey.length >= 82 &&
				apiKey.includes("pat") &&
				apiKey.includes(".")
		);
	}

	static isValidEmail(email: string): boolean {
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

	static extractAirtableIds(url: string): AirtableIds | null {
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

	static buildFieldNames(
		forceDefaultFetchFields: boolean = false,
		iotoRunningLanguage = "ob"
	) {
		if (forceDefaultFetchFields) {
			return {
				title: "Title",
				subFolder: "SubFolder",
				content: "MD",
			};
		}

		const locale = moment.locale();
		const fieldNamesMap: {
			[key: string]: {
				title: string;
				subFolder: string;
				content: string;
			};
		} = {
			"zh-cn": { title: "Title", subFolder: "SubFolder", content: "MD" },
			en: { title: "TitleEN", subFolder: "SubFolderEN", content: "MDEN" },
			"zh-tw": {
				title: "TitleTW",
				subFolder: "SubFolderTW",
				content: "MDTW",
			},
		};

		if (iotoRunningLanguage === "ob") {
			return fieldNamesMap[locale] || fieldNamesMap["en"];
		} else {
			return fieldNamesMap[iotoRunningLanguage] || fieldNamesMap["en"];
		}
	}
}

export function resolve_tfolder(app: App, folder_str: string): TFolder {
	folder_str = normalizePath(folder_str);

	const folder = app.vault.getAbstractFileByPath(folder_str);
	if (!folder) {
		throw new Error(`Folder "${folder_str}" doesn't exist`);
	}
	if (!(folder instanceof TFolder)) {
		throw new Error(`${folder_str} is a file, not a folder`);
	}

	return folder;
}

export function get_tfiles_from_folder(
	app: App,
	folder_str: string
): Array<TFile> {
	const folder = resolve_tfolder(app, folder_str);

	const files: Array<TFile> = [];
	Vault.recurseChildren(folder, (file: TAbstractFile) => {
		if (file instanceof TFile) {
			files.push(file);
		}
	});

	files.sort((a, b) => {
		return a.path.localeCompare(b.path);
	});

	return files;
}
