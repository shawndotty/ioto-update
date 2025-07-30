import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { t } from "../lang/helpers";
import IOTOUpdate from "../main";
import { Utils } from "../utils";
import { IOTOUpdateSettings } from "../types";
import { FolderSuggest } from "./pickers/folder-picker";

export class IOTOUpdateSettingTab extends PluginSettingTab {
	plugin: IOTOUpdate;

	constructor(app: App, plugin: IOTOUpdate) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private createValidatedInputSetting(options: {
		container: HTMLElement;
		name: string;
		desc: string;
		placeholder: string;
		settingKey: keyof IOTOUpdateSettings;
		validationKey: keyof IOTOUpdateSettings;
		validationFn: (value: string) => boolean;
		asyncAction: () => Promise<any>;
		onSuccess: (result: any) => void;
		validText: string;
		validClass: string;
		invalidClass: string;
	}) {
		new Setting(options.container)
			.setName(options.name)
			.setDesc(options.desc)
			.addText((text) => {
				const validSpan = createEl("span", {
					text: options.validText,
					cls: "valid-text",
				});
				const loadingSpan = createEl("span", {
					text: t("Validating..."),
					cls: "loading-text",
				});
				validSpan.style.display = "none";
				loadingSpan.style.display = "none";
				text.inputEl.parentElement?.insertBefore(
					validSpan,
					text.inputEl
				);
				text.inputEl.parentElement?.insertBefore(
					loadingSpan,
					text.inputEl
				);

				const updateValidState = (
					isValid: boolean,
					isLoading: boolean = false
				) => {
					if (isLoading) {
						text.inputEl.removeClass(options.validClass);
						text.inputEl.removeClass(options.invalidClass);
						validSpan.style.display = "none";
						loadingSpan.style.display = "inline";
					} else {
						loadingSpan.style.display = "none";
						if (isValid) {
							text.inputEl.removeClass(options.invalidClass);
							text.inputEl.addClass(options.validClass);
							text.inputEl.style.borderColor = "#4CAF50";
							text.inputEl.style.color = "#4CAF50";
							validSpan.style.display = "inline";
						} else {
							text.inputEl.removeClass(options.validClass);
							text.inputEl.addClass(options.invalidClass);
							text.inputEl.style.borderColor = "#FF5252";
							text.inputEl.style.color = "#FF5252";
							validSpan.style.display = "none";
						}
					}
				};

				// Initial state
				updateValidState(
					this.plugin.settings[options.validationKey] as boolean
				);

				text.setPlaceholder(options.placeholder)
					.setValue(
						this.plugin.settings[options.settingKey] as string
					)
					.onChange(async (value) => {
						(this.plugin.settings[options.settingKey] as any) =
							value;
						if (options.validationFn(value)) {
							updateValidState(false, true); // Show loading
							try {
								const result = await options.asyncAction();
								options.onSuccess(result);
								updateValidState(
									this.plugin.settings[
										options.validationKey
									] as boolean
								);
							} catch (error) {
								new Notice(error.message);
								updateValidState(false);
							}
						} else {
							updateValidState(false);
						}
						await this.plugin.saveSettings();
					});
			});
	}

	private createSearchSetting(options: {
		container: HTMLElement;
		name: string;
		desc: string;
		placeholder: string;
		settingKey: keyof IOTOUpdateSettings;
	}) {
		new Setting(options.container)
			.setName(options.name)
			.setDesc(options.desc)
			.addSearch((text) => {
				new FolderSuggest(this.app, text.inputEl);
				text.setPlaceholder(options.placeholder)
					.setValue(
						this.plugin.settings[options.settingKey] as string
					)
					.onChange(async (value) => {
						(this.plugin.settings[options.settingKey] as any) =
							value;
						await this.plugin.saveSettings();
					});
			});
	}

	private createSimpleTextSetting(options: {
		container: HTMLElement;
		name: string;
		desc: string;
		placeholder: string;
		settingKey: keyof IOTOUpdateSettings;
	}) {
		new Setting(options.container)
			.setName(options.name)
			.setDesc(options.desc)
			.addText((text) =>
				text
					.setPlaceholder(options.placeholder)
					.setValue(
						this.plugin.settings[options.settingKey] as string
					)
					.onChange(async (value) => {
						(this.plugin.settings[options.settingKey] as any) =
							value;
						await this.plugin.saveSettings();
					})
			);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: t("IOTO Update Settings"),
			cls: "my-plugin-title",
		});

		this.createValidatedInputSetting({
			container: containerEl,
			name: t("Your Update API Key"),
			desc: t("Please enter your update API Key"),
			placeholder: t("Enter your update API Key"),
			settingKey: "updateAPIKey",
			validationKey: "updateAPIKeyIsValid",
			validationFn: Utils.isValidApiKey,
			asyncAction: () => this.plugin.apiService.checkApiKey(),
			onSuccess: (isValid) => {
				this.plugin.settings.updateAPIKeyIsValid = isValid;
			},
			validText: t("Valid API Key"),
			validClass: "valid-api-key",
			invalidClass: "invalid-api-key",
		});

		this.createValidatedInputSetting({
			container: containerEl,
			name: t("Your Email Address"),
			desc: t(
				"Please enter the email you provided when you purchase this product"
			),
			placeholder: t("Enter your email"),
			settingKey: "userEmail",
			validationKey: "userChecked",
			validationFn: Utils.isValidEmail,
			asyncAction: () => this.plugin.apiService.getUpdateIDs(),
			onSuccess: ({ updateIDs, userChecked }) => {
				this.plugin.settings.updateIDs = updateIDs;
				this.plugin.settings.userChecked = userChecked;
			},
			validText: t("Valid Email"),
			validClass: "valid-email",
			invalidClass: "invalid-email",
		});

		// 创建一个用于设置 iotoRunningLanguage 的单选设置
		new Setting(containerEl)
			.setName(t("IOTO Running Language"))
			.setDesc(t("Please Chose Your IOTO Framework Running Language"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption("ob", t("Auto (Follow System Language)"))
					.addOption("zh-cn", "中文（简体）")
					.addOption("zh-tw", "中文（繁体）")
					.addOption("en", "English")
					.setValue(this.plugin.settings.iotoRunningLanguage || "ob")
					.onChange(async (value) => {
						this.plugin.settings.iotoRunningLanguage = value;
						await this.plugin.saveSettings();
					});
			});

		this.createSearchSetting({
			container: containerEl,
			name: t("IOTO Framework Path"),
			desc: t("Please enter the path to your IOTO Framework"),
			placeholder: t("Enter the path to your IOTO Framework"),
			settingKey: "iotoFrameworkPath",
		});

		containerEl.createEl("h2", {
			text: t("User Sync Configration Update Settings"),
			cls: "my-plugin-title",
		});

		this.createSimpleTextSetting({
			container: containerEl,
			name: t("Your Airtable Personal Token"),
			desc: t("Please enter your Airtable Personal Token"),
			placeholder: t("Enter your Airtable Personal Token"),
			settingKey: "userAPIKey",
		});

		this.createSimpleTextSetting({
			container: containerEl,
			name: t("Your Sync Setting URL"),
			desc: t("Please enter the url of your sync setting table"),
			placeholder: t("Enter the url"),
			settingKey: "userSyncSettingUrl",
		});

		this.createSearchSetting({
			container: containerEl,
			name: t("Your Sync Templates Folder"),
			desc: t("Please enter the path to your sync templates folder"),
			placeholder: t("Enter the path to your sync templates folder"),
			settingKey: "userSyncScriptsFolder",
		});

		containerEl.createEl("hr");

		const infoContainer = containerEl.createDiv();

		infoContainer.createEl("p", {
			text: t(
				"When you use the sync with online database feature of IOTO, the sync configration generater I built could help you a lot."
			),
		});

		infoContainer.createEl("p", {
			text: t(
				"You can use the following link to open the shared base and save it to your own Airtable workspace."
			),
		});

		const baseLink = infoContainer.createEl("a", {
			text: t("Sync Configration Generator"),
			href: "https://airtable.com/appekNvvdLY7J8zsq/shrpqtEGVjz8bgw9N",
		});
		baseLink.setAttr("target", "_blank");
		baseLink.setAttr("rel", "noopener noreferrer");

		infoContainer.createEl("p", {
			text: t(
				"In order to help you to learn how to use IOTO especially the sync with online database feature, I will keep posting instructions and videos to the following link."
			),
		});

		const deomLink = infoContainer.createEl("a", {
			text: t("IOTO How To Guide"),
			href: "https://airtable.com/appKL3zMp0cOYFdJk/shrbQQvVwAMI4sI0Y",
		});

		deomLink.setAttr("target", "_blank");
		deomLink.setAttr("rel", "noopener noreferrer");
	}
}
