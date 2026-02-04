import { IOTOUpdateSettings } from "../types";
import { t } from "../lang/helpers";

export const DEFAULT_SETTINGS: IOTOUpdateSettings = {
	updateAPIKey: "",
	updateAPIKeyIsValid: false,
	iotoRunningLanguage: "ob",
	userEmail: "",
	pluginDownloadSource: "gitee",
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
