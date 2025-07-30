import { App } from "obsidian";

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
		dom: {
			appContainerEl: HTMLElement;
		};
	}
}

export interface AirtableIds {
	baseId: string;
	tableId: string;
	viewId: string;
}

export interface IOTOUpdateSettings {
	updateAPIKey: string;
	updateAPIKeyIsValid: boolean;
	iotoRunningLanguage: string;
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

export interface NocoDBTable {
	viewID: string;
	baseID?: string;
	tableID?: string;
	targetFolderPath: string;
	intialSetup?: boolean;
}

export interface NocoDBSettings {
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

export interface RecordFields {
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

export interface Record {
	fields: RecordFields;
}

export interface DateFilterOption {
	id: string;
	name: string;
	value: number;
}

declare function requestUrl(options: any): Promise<any>;
