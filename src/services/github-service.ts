import { App, Notice, requestUrl } from "obsidian";
import { t } from "../lang/helpers";
import { PluginService } from "./plugin-service";

export interface InstallPluginOptions {
		/**
		 * After installing / updating the plugin files, automatically call
		 * PluginService.reloadAndEnablePlugin to hot-reload the plugin.
		 *
		 * Defaults to `true` for backward compatibility.
		 *
		 * Set to `false` when the caller is updating **its own** plugin and
		 * intends to perform a full `app:reload` afterwards, otherwise the
		 * currently open settings tab of that plugin will become blank because
		 * disablePlugin() tears down the associated SettingTab instance from
		 * under the settings modal.
		 */
		autoReload?: boolean;
	}

export class GithubService {
	/**
	 * 远程 manifest 信息的内存缓存，避免频繁请求 GitHub API 触发限流。
	 * key 为 repoUrl，value 为 { data, timestamp }。
	 */
	private static manifestCache = new Map<
		string,
		{
			data: { id: string; name: string; version: string };
			timestamp: number;
		}
	>();

	/** 缓存有效期：10 分钟 */
	private static readonly CACHE_TTL = 10 * 60 * 1000;

	/**
	 * 清除指定仓库的 manifest 缓存；若不传 repoUrl 则清除全部。
	 */
	static clearManifestCache(repoUrl?: string) {
		if (repoUrl) {
			this.manifestCache.delete(repoUrl);
		} else {
			this.manifestCache.clear();
		}
	}

	static async getLatestPluginManifest(
		repoUrl: string,
	): Promise<{ id: string; name: string; version: string } | null> {
		// 优先读取缓存，未过期则直接返回
		const cached = this.manifestCache.get(repoUrl);
		if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
			return cached.data;
		}

		try {
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) return null;

			// 直接通过 release 下载 URL 获取最新 manifest.json，
			// 不经过 GitHub API，避免触发 60 次/小时的未认证限流。
			// URL 格式：https://github.com/owner/repo/releases/latest/download/manifest.json
			const manifestUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/releases/latest/download/manifest.json`;
			const manifestContent = await this.downloadAsset(manifestUrl);
			const manifest = JSON.parse(manifestContent);
			if (!manifest || !manifest.id) return null;

			const result = {
				id: manifest.id,
				name: manifest.name || manifest.id,
				version: manifest.version,
			};
			// 写入缓存
			this.manifestCache.set(repoUrl, {
				data: result,
				timestamp: Date.now(),
			});
			return result;
		} catch (error) {
			console.error("Failed to fetch latest plugin manifest:", error);
			return null;
		}
	}

	/**
	 * Installs or updates a plugin from a GitHub repository URL.
	 * @param app The Obsidian App instance
	 * @param repoUrl The GitHub repository URL (e.g., https://github.com/owner/repo)
	 * @param options Optional install behavior flags.
	 */
	static async installPluginFrom(
		app: App,
		repoUrl: string,
		options: InstallPluginOptions = {},
	): Promise<void> {
		const { autoReload = true } = options;
		let notice: Notice | null = null;
		try {
			// 1. Parse the repository URL
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) {
				new Notice(t("Invalid GitHub repository URL"));
				return;
			}
			const { owner, repo } = repoInfo;

			notice = new Notice(
				`${t("Checking for updates from")} ${owner}/${repo}...`,
				0,
			);

			// 获取插件 release 文件（manifest.json / main.js / styles.css），
			// 优先通过 releases/latest/download 直连下载（不走 API，不受 60 次/小时限流影响），
			// 直连失败时降级到 GitHub API。
			const files = await this.fetchPluginReleaseFiles(owner, repo);
			if (!files || !files.manifestContent || !files.mainJsContent) {
				if (notice) notice.hide();
				new Notice(t("No release found for this repository"));
				return;
			}

			const manifest = JSON.parse(files.manifestContent);
			const pluginId = manifest.id;

			if (!pluginId) {
				if (notice) notice.hide();
				new Notice(t("Invalid manifest.json: missing 'id' field"));
				return;
			}

			// Check if plugin is already installed and up to date
			const installedPlugin = app.plugins.manifests?.[pluginId];
			if (
				installedPlugin &&
				installedPlugin.version === manifest.version
			) {
				if (notice) notice.hide();
				new Notice(
					`${t("Plugin")} "${manifest.name}" ${t("is already up to date")}`,
				);
				return;
			}

			if (notice) notice.hide();
			notice = new Notice(t("Downloading plugin files"), 0);

			// 2. Ensure plugin directory exists
			// app.vault.configDir usually is ".obsidian"
			const pluginDir = `${app.vault.configDir}/plugins/${pluginId}`;
			const adapter = app.vault.adapter;

			if (!(await adapter.exists(pluginDir))) {
				await adapter.mkdir(pluginDir);
			}

			// 3. Write files
			await adapter.write(
				`${pluginDir}/manifest.json`,
				files.manifestContent,
			);
			await adapter.write(`${pluginDir}/main.js`, files.mainJsContent);
			if (files.stylesCssContent) {
				await adapter.write(
					`${pluginDir}/styles.css`,
					files.stylesCssContent,
				);
			}

			if (notice) notice.hide();

			// 尝试重新加载插件：先刷新 manifest，然后禁用再启用
			// @ts-ignore 访问内部 API
			const plugins = app.plugins;
			if (autoReload) {
				try {
					if (plugins) {
						await PluginService.reloadAndEnablePlugin(
							app,
							pluginId,
						);

						new Notice(
							`${t("Plugin")} "${manifest.name}" ${t(
								"installed/updated successfully",
							)} & ${t("reloaded")}`,
						);
					}
				} catch (reloadErr) {
					console.warn(
						t("Automatic reload failed") + ":",
						reloadErr,
					);
					new Notice(
						`${t("Plugin")} "${manifest.name}" ${t(
							"installed/updated successfully",
						)}`,
					);
					new Notice(t("Plugin updated but reload failed"));
				}
			} else {
				new Notice(
					`${t("Plugin")} "${manifest.name}" ${t(
						"installed/updated successfully",
					)}`,
				);
			}
		} catch (error) {
			if (notice) notice.hide();
			console.error(t("Failed to install plugin") + ":", error);
			new Notice(t("Check console for details"));
		}
	}

	/**
	 * 获取插件 release 中的 manifest.json / main.js / styles.css 文件内容。
	 *
	 * 优先使用 GitHub 的 releases/latest/download/{file} 直连下载 URL：
	 * 这是 GitHub 提供的 302 重定向链接，指向最新 release 的附件，
	 * 完全不走 REST API，不受未认证 60 次/小时的限流影响。
	 *
	 * 当直连失败（例如仓库未发布 release、附件缺失、网络异常）时，
	 * 降级到 GitHub REST API（api.github.com/repos/.../releases/latest），
	 * 从 release.assets[].browser_download_url 获取真正的下载地址。
	 *
	 * @returns 成功返回三个文件内容；失败返回 null
	 */
	private static async fetchPluginReleaseFiles(
		owner: string,
		repo: string,
	): Promise<{
		manifestContent: string;
		mainJsContent: string;
		stylesCssContent: string;
	} | null> {
		// 方案 1：直连下载 URL（不走 API，不受限流影响）
		const baseUrl = `https://github.com/${owner}/${repo}/releases/latest/download`;
		try {
			const manifestContent = await this.downloadAsset(
				`${baseUrl}/manifest.json`,
			);
			const mainJsContent = await this.downloadAsset(
				`${baseUrl}/main.js`,
			);
			// styles.css 可选：很多插件没有 styles.css，404 视为正常
			let stylesCssContent = "";
			try {
				stylesCssContent = await this.downloadAsset(
					`${baseUrl}/styles.css`,
				);
			} catch {
				// styles.css 不存在是正常的，静默跳过
			}
			return { manifestContent, mainJsContent, stylesCssContent };
		} catch (directErr) {
			console.warn(
				"GitHub direct download failed, falling back to API:",
				directErr,
			);
		}

		// 方案 2：直连失败时降级到 GitHub REST API
		try {
			const release = await this.getLatestRelease(owner, repo);
			if (!release) return null;

			const manifestAsset = release.assets.find(
				(a: any) => a.name === "manifest.json",
			);
			const mainJsAsset = release.assets.find(
				(a: any) => a.name === "main.js",
			);
			const stylesCssAsset = release.assets.find(
				(a: any) => a.name === "styles.css",
			);

			if (!manifestAsset || !mainJsAsset) return null;

			const manifestContent = await this.downloadAsset(
				manifestAsset.browser_download_url,
			);
			const mainJsContent = await this.downloadAsset(
				mainJsAsset.browser_download_url,
			);
			let stylesCssContent = "";
			if (stylesCssAsset) {
				stylesCssContent = await this.downloadAsset(
					stylesCssAsset.browser_download_url,
				);
			}
			return { manifestContent, mainJsContent, stylesCssContent };
		} catch (apiErr) {
			console.error(
				"GitHub API fallback also failed for fetching plugin files:",
				apiErr,
			);
			return null;
		}
	}

	static async getLatestPluginVersion(
		repoUrl: string,
	): Promise<string | null> {
		const manifest = await this.getLatestPluginManifest(repoUrl);
		return manifest ? manifest.version : null;
	}

	private static parseRepoUrl(
		url: string,
	): { owner: string; repo: string } | null {
		// Matches https://github.com/owner/repo or just owner/repo
		const regex = /github\.com\/([^\/]+)\/([^\/]+)/;
		const match = url.match(regex);
		if (match) {
			return { owner: match[1], repo: match[2].replace(".git", "") };
		}

		// Also support just "owner/repo" format if needed, but let's stick to full URL for now as requested
		// or check simple split
		const parts = url.split("/");
		if (parts.length === 2) {
			return { owner: parts[0], repo: parts[1] };
		}

		return null;
	}

	private static async getLatestRelease(
		owner: string,
		repo: string,
	): Promise<any> {
		const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
		try {
			const response = await requestUrl({
				url: url,
				method: "GET",
				headers: {
					Accept: "application/vnd.github.v3+json",
				},
			});
			if (response.status === 200) {
				return response.json;
			}
		} catch (e) {
			console.error("Error fetching release:", e);
		}
		return null;
	}

	private static async downloadAsset(url: string): Promise<string> {
		const response = await requestUrl({
			url: url,
			method: "GET",
		});
		return response.text;
	}
}
