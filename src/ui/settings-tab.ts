import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { t } from "../lang/helpers";
import IOTOUpdate from "../main";
import { Utils } from "../utils";
import { IOTOUpdateSettings } from "../types";
import { FolderSuggest } from "./pickers/folder-picker";
import { TabbedSettings } from "./tabbed-settings";

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
		reload: boolean;
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

				// 记录初始值，用于比较是否有变化
				const initialValue = this.plugin.settings[
					options.settingKey
				] as string;
				let hasValueChanged = false;

				text.setPlaceholder(options.placeholder)
					.setValue(initialValue)
					.onChange(async (value) => {
						// 只更新设置值，不触发验证
						(this.plugin.settings[options.settingKey] as any) =
							value;
						// 标记值已发生变化
						hasValueChanged = true;
						await this.plugin.saveSettings();
					});

				// 添加失去焦点事件监听器
				text.inputEl.addEventListener("blur", async () => {
					// 只有在值发生变化时才执行验证逻辑
					if (!hasValueChanged) {
						return;
					}

					const value = text.inputEl.value;
					console.log(value);
					// 在失去焦点时触发验证
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
						options.onSuccess(false);
					}
					await this.plugin.saveSettings();

					if (
						this.plugin.settings[options.validationKey] &&
						options.reload
					) {
						// 在输入框后面添加一个重新加载按钮，使用 reload emoji，点击后重新加载 Obsidian
						const reloadButton = document.createElement("button");
						reloadButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;" xmlns="http://www.w3.org/2000/svg"><path d="M12 4a8 8 0 1 1-8 8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><polyline points="4 4 4 8 8 8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
						reloadButton.title = t("Reload OB") as string;
						reloadButton.style.padding = "2px 8px";
						reloadButton.style.border = "1px solid #888";
						reloadButton.style.borderRadius = "4px";
						reloadButton.style.cursor = "pointer";
						reloadButton.onclick = () => {
							this.app.commands.executeCommandById("app:reload");
						};
						// 将按钮插入到输入框后面
						text.inputEl.parentElement?.appendChild(reloadButton);
					}

					// 重置变化标记
					hasValueChanged = false;
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

		containerEl.createEl("h1", {
			text: t("IOTO Update Settings"),
			cls: "my-plugin-title",
		});

		const tabbedSettings = new TabbedSettings(containerEl);

		tabbedSettings.addTab("Basic", (content: HTMLElement) =>
			this.renderBasicSettings(content)
		);

		if (
			this.plugin.settings.updateIDs.iotoSettingPlugin?.viewID ===
			"viwZvtQy1GDWu00sA"
		) {
			tabbedSettings.addTab("User Sync", (content: HTMLElement) =>
				this.renderUserSyncSettings(content)
			);
		}
	}

	private renderBasicSettings(containerEl: HTMLElement) {
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
			reload: false,
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
			reload: true,
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
	}

	private renderUserSyncSettings(containerEl: HTMLElement) {
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
			href: "https://airtable.com/app84J6QgVNsTUdPQ/shrJhhMFksy7XTrRb",
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
