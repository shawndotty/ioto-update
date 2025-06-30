import { Notice } from "obsidian";
import { IOTOUpdateSettings } from "./types";
import { AIRTABLE_CONFIG, DEFAULT_UPDATE_IDS } from "./constants";

declare function requestUrl(options: any): Promise<any>;

export class ApiService {
	private settings: IOTOUpdateSettings;

	constructor(settings: IOTOUpdateSettings) {
		this.settings = settings;
	}

	async getUpdateIDs() {
		const userEmail = this.settings.userEmail.trim();
		const getUpdateIDsUrl = `https://api.airtable.com/v0/${
			AIRTABLE_CONFIG.GET_UPDATE_IDS.BASE_ID
		}/${
			AIRTABLE_CONFIG.GET_UPDATE_IDS.TABLE_NAME
		}?maxRecords=1&filterByFormula=${encodeURI(
			"{Email} = '" + userEmail + "'"
		)}&fields%5B%5D=${
			AIRTABLE_CONFIG.GET_UPDATE_IDS.FIELDS.IOTO_UPDATE_IDS
		}`;
		const getUpdateIDsToken = AIRTABLE_CONFIG.GET_UPDATE_IDS.TOKEN;

		const response = await requestUrl({
			url: getUpdateIDsUrl,
			method: "GET",
			headers: { Authorization: "Bearer " + getUpdateIDsToken },
		});

		if (
			response.json.records.length &&
			response.json.records[0].fields[
				AIRTABLE_CONFIG.GET_UPDATE_IDS.FIELDS.IOTO_UPDATE_IDS
			]
		) {
			this.settings.updateIDs = JSON.parse(
				response.json.records[0].fields[
					AIRTABLE_CONFIG.GET_UPDATE_IDS.FIELDS.IOTO_UPDATE_IDS
				].first()
			);
			this.settings.userChecked = true;
		} else {
			this.settings.updateIDs = DEFAULT_UPDATE_IDS;
			this.settings.userChecked = false;
		}

		return this.settings;
	}

	async checkApiKey() {
		const updateUUID = crypto.randomUUID();
		const checkApiWebHookUrl = AIRTABLE_CONFIG.CHECK_API_KEY.WEBHOOK_URL;
		const checkApiValidUrl = `https://api.airtable.com/v0/${
			AIRTABLE_CONFIG.CHECK_API_KEY.BASE_ID
		}/${AIRTABLE_CONFIG.CHECK_API_KEY.TABLE_NAME}?maxRecords=1&view=${
			AIRTABLE_CONFIG.CHECK_API_KEY.VIEW_ID
		}&filterByFormula=${encodeURI(
			`{${AIRTABLE_CONFIG.CHECK_API_KEY.FIELDS.UUID}} = '${updateUUID}'`
		)}&fields%5B%5D=${AIRTABLE_CONFIG.CHECK_API_KEY.FIELDS.MATCH}`;
		const checkApiValidToken = AIRTABLE_CONFIG.CHECK_API_KEY.TOKEN;
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
				validKey =
					matchRes.json.records[0].fields[
						AIRTABLE_CONFIG.CHECK_API_KEY.FIELDS.MATCH
					];
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

		return this.settings;
	}
}
