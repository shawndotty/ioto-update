import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { t } from "../lang/helpers";
import IOTOUpdate from "../main";
import { Utils } from "../utils";
import { GithubService } from "../services/github-service";
import { GiteeService } from "../services/gitee-service";
import {
	IOTO_PLUGINS,
	IOTOPluginEntry,
	isSSGViewIDAllowed,
} from "../services/plugin-registry";
import { IOTOUpdateSettings } from "../types";
import { FolderSuggest } from "./pickers/folder-picker";
import { TabbedSettings } from "./tabbed-settings";

interface PluginStatus {
	state:
		| "loading"
		| "not-installed"
		| "installed"
		| "update-available"
		| "error";
	pluginId?: string;
	installedVersion?: string;
	latestVersion?: string;
}

export class IOTOUpdateSettingTab extends PluginSettingTab {
	plugin: IOTOUpdate;

	constructor(app: App, plugin: IOTOUpdate) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h1", {
			text: t("IOTO Update Settings"),
			cls: "my-plugin-title",
		});

		const tabbedSettings = new TabbedSettings(containerEl);

		tabbedSettings.addTab(t("Basic"), (content: HTMLElement) =>
			this.renderBasicSettings(content),
		);

		tabbedSettings.addTab(t("Plugins Center"), (content: HTMLElement) =>
			this.renderPluginsCenter(content),
		);
        
		// tabbedSettings.addTab(t("IOTO_UPDATES"), (content: HTMLElement) =>
		// 	this.renderIOTOUpdatesSettings(content),
		// );

		tabbedSettings.addTab(t("IOTO_TOTURIALS"), (content: HTMLElement) =>
			this.renderIOTOToturialsSettings(content),
		);

	}

	private renderBasicSettings(containerEl: HTMLElement) {
		const { updateAPIKeyIsValid, userChecked, updateAPIKey, userEmail } =
			this.plugin.settings;
		if (
			!updateAPIKeyIsValid ||
			!userChecked ||
			!updateAPIKey ||
			!userEmail
		) {
			this.renderLicensePurchaseInfo(containerEl);
		}

		const currentVersion = this.plugin.manifest.version;

		const versionSetting = new Setting(containerEl)
			.setName(`${t("Current Version")}: ${currentVersion}`)
			.setDesc(t("Check for Updates"))
			.addButton((button) => {
				button
					.setButtonText(t("Check for Updates"))
					.onClick(async () => {
						button.setButtonText(t("Checking..."));
						button.setDisabled(true);
						const source =
							this.plugin.settings.pluginDownloadSource ||
							"github";
						const repoUrl =
							source === "github"
								? "https://github.com/shawndotty/ioto-update"
								: "https://gitee.com/johnnylearns/ioto-update";
						const latestVersion =
							source === "github"
								? await GithubService.getLatestPluginVersion(
										repoUrl,
									)
								: await GiteeService.getLatestPluginVersion(
										repoUrl,
									);

						button.setDisabled(false);

						if (!latestVersion) {
							button.setButtonText(t("Check for Updates"));
							new Notice(t("Failed to check for updates"));
							return;
						}

						const cmp = Utils.compareVersions(
							currentVersion,
							latestVersion,
						);

						if (cmp === 0) {
							versionSetting.setDesc(t("Already up to date"));
							button.setButtonText(t("Check for Updates"));
						} else if (cmp < 0) {
							versionSetting.setDesc(
								`${t("Update available")}: ${latestVersion}`,
							);
							versionSetting.controlEl.empty();
							versionSetting.addButton((b) => {
								b.setButtonText(t("Start Update"))
									.setCta()
									.onClick(async () => {
										b.setButtonText(t("Updating..."));
										b.setDisabled(true);
										try {
											if (source === "github") {
												await GithubService.installPluginFrom(
													this.app,
													repoUrl,
													{ autoReload: false },
												);
											} else {
												await GiteeService.installPluginFrom(
													this.app,
													repoUrl,
													{ autoReload: false },
												);
											}
											b.setButtonText(t("Updated"));
											new Notice(
												t(
													"Reloading Obsidian to apply update...",
												),
											);
											setTimeout(() => {
												this.app.commands.executeCommandById(
													"app:reload",
												);
											}, 500);
										} catch (err) {
											console.error(err);
											b.setButtonText(
												t("Start Update"),
											);
											b.setDisabled(false);
											new Notice(
												t(
													"Failed to install plugin",
												),
											);
										}
									});
							});
						} else {
							versionSetting.setDesc(
								t("You are using a development version"),
							);
							button.setButtonText(t("Check for Updates"));
						}
					});
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
			reload: false,
			validText: t("Valid API Key"),
			validClass: "valid-api-key",
			invalidClass: "invalid-api-key",
		});

		this.createValidatedInputSetting({
			container: containerEl,
			name: t("Your Email Address"),
			desc: t(
				"Please enter the email you provided when you purchase this product",
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

		new Setting(containerEl)
			.setName(t("Plugin Download Source"))
			.setDesc(t("Choose where to download and update plugins"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption("github", t("GitHub"))
					.addOption("gitee", t("Gitee"))
					.setValue(
						this.plugin.settings.pluginDownloadSource || "github",
					)
					.onChange(async (value) => {
						this.plugin.settings.pluginDownloadSource =
							value as any;
						await this.plugin.saveSettings();
					});
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

	private renderIOTOUpdatesSettings(containerEl: HTMLElement) {
		this.renderIframeSettings(
			containerEl,
			"ioto-updates-iframe-container",
			"https://airtable.com/embed/appKL3zMp0cOYFdJk/shrGmdbDRAD6ZKqGt?backgroundColor=cyan&viewControls=on",
		);
	}

	private renderIOTOToturialsSettings(containerEl: HTMLElement) {
		this.renderIframeSettings(
			containerEl,
			"ioto-toturials-iframe-container",
			"https://airtable.com/embed/appKL3zMp0cOYFdJk/shrbQQvVwAMI4sI0Y?backgroundColor=cyan&viewControls=on",
		);
	}

	private renderPluginsCenter(containerEl: HTMLElement) {

		new Setting(containerEl).setDesc(t("IOTO Plugins Center Description"));

		const source = this.plugin.settings.pluginDownloadSource || "github";
		const viewID =
			this.plugin.settings.updateIDs.iotoSettingPlugin?.viewID;

		const list = containerEl.createDiv("ioto-plugins-list");

		IOTO_PLUGINS.forEach((entry) => {
			// 同步脚本生成器仅对特定 viewID 用户开放，与命令面板逻辑保持一致
			if (entry.requireViewID && !isSSGViewIDAllowed(viewID)) {
				return;
			}

			const setting = new Setting(list)
				.setName(t(entry.nameKey))
				.setDesc(`${t(entry.descKey)} — ${t("Checking...")}`);

			// 异步加载插件状态后刷新当前 Setting 行
			this.loadPluginStatus(entry, source).then((status) => {
				this.updatePluginSetting(setting, entry, status, source);
			});
		});
	}

	private async loadPluginStatus(
		entry: IOTOPluginEntry,
		source: string,
	): Promise<PluginStatus> {
		const repoUrl =
			source === "github" ? entry.githubUrl : entry.giteeUrl;
		const service =
			source === "github" ? GithubService : GiteeService;

		const manifest = await service.getLatestPluginManifest(repoUrl);
		if (!manifest) {
			return { state: "error" };
		}

		const installed = this.app.plugins.manifests[manifest.id];
		if (!installed) {
			return {
				state: "not-installed",
				pluginId: manifest.id,
				latestVersion: manifest.version,
			};
		}

		const cmp = Utils.compareVersions(
			installed.version,
			manifest.version,
		);
		if (cmp < 0) {
			return {
				state: "update-available",
				pluginId: manifest.id,
				installedVersion: installed.version,
				latestVersion: manifest.version,
			};
		}

		return {
			state: "installed",
			pluginId: manifest.id,
			installedVersion: installed.version,
			latestVersion: manifest.version,
		};
	}

	private updatePluginSetting(
		setting: Setting,
		entry: IOTOPluginEntry,
		status: PluginStatus,
		source: string,
	) {
		// 清空已有按钮
		setting.controlEl.empty();

		const baseDesc = t(entry.descKey);
		let desc = baseDesc;

		switch (status.state) {
			case "error":
				desc = `${baseDesc} — ${t("Failed to check plugin info")}`;
				setting.addButton((b) =>
					b
						.setButtonText(t("Retry"))
						.onClick(() =>
							this.refreshPluginStatus(setting, entry, source),
						),
				);
				break;

			case "not-installed":
				desc = `${baseDesc} — ${t("Not installed")} (${t(
					"Latest version",
				)}: v${status.latestVersion})`;
				setting.addButton((b) =>
					b
						.setButtonText(t("Install"))
						.setCta()
						.onClick(() =>
							this.installPlugin(setting, entry, source),
						),
				);
				break;

			case "installed":
				desc = `${baseDesc} — ${t("Installed")} v${
					status.installedVersion
				} (${t("Latest version")}: v${status.latestVersion})`;
				setting.addButton((b) =>
					b
						.setButtonText(t("Check for updates"))
						.onClick(() =>
							this.refreshPluginStatus(setting, entry, source),
						),
				);
				break;

			case "update-available":
				desc = `${baseDesc} — ${t(
					"Update available",
				)}: v${status.installedVersion} → v${status.latestVersion}`;
				setting.addButton((b) =>
					b
						.setButtonText(t("Update"))
						.setCta()
						.onClick(() =>
							this.installPlugin(setting, entry, source),
						),
				);
				break;
		}

		setting.setDesc(desc);
		this.appendRepoIcons(setting, entry);
	}

	/**
	 * 在 Setting 的描述下方追加 GitHub / Gitee 仓库链接图标。
	 * 点击在新窗口打开对应仓库页面，方便用户查看插件源码与文档。
	 *
	 * 因 setDesc 会清空 descEl 内容，此方法需在每次 setDesc 之后调用。
	 */
	private appendRepoIcons(setting: Setting, entry: IOTOPluginEntry) {
		const iconsEl = setting.descEl.createDiv({
			cls: "ioto-repo-icons",
		});

		// GitHub 链接（经典 GitHub 图标）
		const githubLink = iconsEl.createEl("a", {
			cls: "ioto-repo-link ioto-repo-link--github",
			href: entry.githubUrl,
			attr: {
				target: "_blank",
				rel: "noopener noreferrer",
				"aria-label": "GitHub",
				title: "GitHub",
			},
		});
		githubLink.insertAdjacentHTML(
			"beforeend",
			'<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
		);

		// Gitee 链接（红色圆形 + 白色 G，接近 Gitee 官方 logo）
		const giteeLink = iconsEl.createEl("a", {
			cls: "ioto-repo-link ioto-repo-link--gitee",
			href: entry.giteeUrl,
			attr: {
				target: "_blank",
				rel: "noopener noreferrer",
				"aria-label": "Gitee",
				title: "Gitee",
			},
		});
		giteeLink.insertAdjacentHTML(
			"beforeend",
			'<svg viewBox="0 0 90 90" width="16" height="16" aria-hidden="true"><circle cx="44.854" cy="44.854" r="44.854" fill="currentColor"/><path d="M67.559 39.871 L42.086 39.871 C40.863 39.872 39.871 40.863 39.870 42.086 L39.869 47.624 C39.868 48.847 40.859 49.839 42.083 49.839 L57.591 49.839 C58.814 49.839 59.806 50.830 59.806 52.054 L59.806 53.161 C59.806 56.831 56.831 59.806 53.161 59.806 L32.117 59.806 C30.893 59.806 29.902 58.815 29.902 57.591 L29.901 36.549 C29.901 32.879 32.876 29.904 36.546 29.904 L67.552 29.904 C68.775 29.903 69.767 28.912 69.769 27.689 L69.772 22.152 C69.774 20.928 68.783 19.936 67.560 19.935 L36.548 19.937 C27.373 19.937 19.935 27.374 19.935 36.549 L19.935 67.559 C19.935 68.782 20.927 69.774 22.150 69.774 L54.822 69.774 C63.080 69.774 69.774 63.080 69.774 54.822 L69.774 42.086 C69.774 40.863 68.782 39.871 67.559 39.871 Z" fill="var(--background-primary)"/></svg>',
		);
	}

	private refreshPluginStatus(
		setting: Setting,
		entry: IOTOPluginEntry,
		source: string,
	) {
		// 手动刷新时先清除该插件的缓存，强制重新请求
		const repoUrl =
			source === "github" ? entry.githubUrl : entry.giteeUrl;
		if (source === "github") {
			GithubService.clearManifestCache(repoUrl);
		} else {
			GiteeService.clearManifestCache(repoUrl);
		}

		setting.controlEl.empty();
		setting.setDesc(`${t(entry.descKey)} — ${t("Checking...")}`);
		this.appendRepoIcons(setting, entry);
		this.loadPluginStatus(entry, source).then((status) =>
			this.updatePluginSetting(setting, entry, status, source),
		);
	}

	private async installPlugin(
		setting: Setting,
		entry: IOTOPluginEntry,
		source: string,
	) {
		const repoUrl =
			source === "github" ? entry.githubUrl : entry.giteeUrl;

		setting.controlEl.empty();
		setting.addButton((b) =>
			b.setButtonText(t("Installing...")).setDisabled(true),
		);

		try {
			if (source === "github") {
				await GithubService.installPluginFrom(this.app, repoUrl, {
					autoReload: true,
				});
			} else {
				await GiteeService.installPluginFrom(this.app, repoUrl, {
					autoReload: true,
				});
			}
		} catch (err) {
			console.error("Failed to install plugin", err);
			new Notice(t("Failed to install plugin"));
		}

		// 安装完成后重新检测状态并刷新 UI
		this.refreshPluginStatus(setting, entry, source);
	}

	private renderIframeSettings(
		containerEl: HTMLElement,
		cls: string,
		embedUrl: string,
	) {
		containerEl.empty();

		const iframeContainer = containerEl.createDiv({
			cls: cls,
		});

		const iframe = iframeContainer.createEl("iframe");
		iframe.setAttr("src", embedUrl);
		iframe.setAttr("frameborder", "0");
		iframe.setAttr("onmousewheel", "");
		iframe.setAttr("width", "100%");
		iframe.setAttr("height", "600px");
		iframe.setAttr(
			"style",
			"background: transparent; border: 1px solid var(--background-modifier-border);",
		);
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
				"When you use the sync with online database feature of IOTO, the sync configration generater I built could help you a lot.",
			),
		});

		infoContainer.createEl("p", {
			text: t(
				"You can use the following link to open the shared base and save it to your own Airtable workspace.",
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
				"In order to help you to learn how to use IOTO especially the sync with online database feature, I will keep posting instructions and videos to the following link.",
			),
		});

		const deomLink = infoContainer.createEl("a", {
			text: t("IOTO How To Guide"),
			href: "https://airtable.com/appKL3zMp0cOYFdJk/shrbQQvVwAMI4sI0Y",
		});

		deomLink.setAttr("target", "_blank");
		deomLink.setAttr("rel", "noopener noreferrer");
	}

	private renderLicensePurchaseInfo(containerEl: HTMLElement) {
		const licenseContainer = containerEl.createDiv({
			cls: "ioto-license-container",
		});
		licenseContainer.createEl("p", {
			text: t("LicensePurchaseInfo"),
		});
		licenseContainer.createEl("p", {
			text: t("AuthorWechatID"),
		});
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
					text.inputEl,
				);
				text.inputEl.parentElement?.insertBefore(
					loadingSpan,
					text.inputEl,
				);

				const updateValidState = (
					isValid: boolean,
					isLoading: boolean = false,
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
					this.plugin.settings[options.validationKey] as boolean,
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
								] as boolean,
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
						this.plugin.settings[options.settingKey] as string,
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
						this.plugin.settings[options.settingKey] as string,
					)
					.onChange(async (value) => {
						(this.plugin.settings[options.settingKey] as any) =
							value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
