// Airtable API 配置常量
export const AIRTABLE_CONFIG = {
	// 获取更新ID的配置
	GET_UPDATE_IDS: {
		BASE_ID: "appxQqkHaEkjUQnBf",
		TABLE_NAME: "EmailSync",
		TOKEN: "patCw7AoXaktNgHNM.bf8eb50a33da820fde56b1f5d4cf5899bc8c508096baf36b700e94cd13570000",
		FIELDS: {
			IOTO_UPDATE_IDS: "IOTOUpdateIDs",
		},
	},

	// 检查API密钥的配置
	CHECK_API_KEY: {
		WEBHOOK_URL:
			"https://hooks.airtable.com/workflows/v1/genericWebhook/appq9k6KwHV3lEIJZ/wfl2uT25IPEljno9w/wtrFUIEC8SXlDsdIu",
		BASE_ID: "appq9k6KwHV3lEIJZ",
		TABLE_NAME: "UpdateLogs",
		VIEW_ID: "viweTQ2YarquoqZUT",
		TOKEN: "patCw7AoXaktNgHNM.bf8eb50a33da820fde56b1f5d4cf5899bc8c508096baf36b700e94cd13570000",
		FIELDS: {
			UUID: "UUID",
			MATCH: "Match",
		},
	},
};

// 默认的更新ID结构
export const DEFAULT_UPDATE_IDS = {
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
};
