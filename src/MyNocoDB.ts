import { NocoDBTable, NocoDBSettings } from "./types";

export class MyNocoDB {
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
