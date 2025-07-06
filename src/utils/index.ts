import { moment } from "obsidian";
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

	static buildFieldNames(forceDefaultFetchFields: boolean = false) {
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
