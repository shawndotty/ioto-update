import { App, Notice, requestUrl } from "obsidian";
import { t } from "../lang/helpers";
import { Utils } from "../utils";
import {
	InstallPluginOptions,
	InstallPluginResult,
} from "./install-types";
import { PluginService } from "./plugin-service";

/** 单次网络请求超时：超过即判失败，避免 11 个插件串行时被一个卡死的请求拖住。 */
const REQUEST_TIMEOUT_MS = 30 * 1000;

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
	 *
	 * @returns 判定结果。旧调用方可直接忽略（以前返回 `void`）。
	 */
	static async installPluginFrom(
		app: App,
		repoUrl: string,
		options: InstallPluginOptions = {},
	): Promise<InstallPluginResult> {
		const { autoReload = true, silent = false } = options;
		let notice: Notice | null = null;
		const notify = (message: string, timeout?: number) => {
			if (!silent) new Notice(message, timeout);
		};
		try {
			// 1. Parse the repository URL
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) {
				notify(t("Invalid GitHub repository URL"));
				return { status: "not-found", error: "invalid-repo-url" };
			}
			const { owner, repo } = repoInfo;

			if (!silent) {
				notice = new Notice(
					`${t("Checking for updates from")} ${owner}/${repo}...`,
					0,
				);
			}

			// 获取插件 release 文件（manifest.json / main.js / styles.css），
			// 优先通过 releases/latest/download 直连下载（不走 API，不受 60 次/小时限流影响），
			// 直连失败时降级到 GitHub API。
			const files = await this.fetchPluginReleaseFiles(owner, repo);
			if (!files || !files.manifestContent || !files.mainJsContent) {
				if (notice) notice.hide();
				notify(t("No release found for this repository"));
				return { status: "not-found", error: "no-release" };
			}

			const manifest = JSON.parse(files.manifestContent);
			const pluginId = manifest.id;

			if (!pluginId) {
				if (notice) notice.hide();
				notify(t("Invalid manifest.json: missing 'id' field"));
				return { status: "failed", error: "missing-id" };
			}

			// 统一结果骨架：后续每个 return 点只补 status / 版本
			const base: Omit<InstallPluginResult, "status"> = {
				pluginId,
				name: manifest.name,
				toVersion: manifest.version,
			};

			// 判定「是否已安装」要兼容旧 id（SlidesRup 改过 id）
			const installedId = PluginService.resolveInstalledPluginId(
				app,
				pluginId,
			);
			const legacyId =
				installedId && installedId !== pluginId
					? installedId
					: undefined;
			const resultBase: Omit<InstallPluginResult, "status"> = { ...base, legacyId };

			// 本地版本以磁盘为准（内存 manifests 可能滞后）；已安装但读不到时才退回内存
			const local = installedId
				? await PluginService.readInstalledManifest(app, installedId)
				: null;
			const localVersion = local?.version;

			if (localVersion) {
				const cmp = Utils.compareVersions(
					localVersion,
					manifest.version,
				);
				if (cmp === 0) {
					if (notice) notice.hide();
					notify(
						`${t("Plugin")} "${manifest.name}" ${t(
							"is already up to date",
						)}`,
					);
					return {
						...resultBase,
						status: "up-to-date",
						fromVersion: localVersion,
					};
				}
				if (cmp > 0) {
					// 本地比远端新（开发版）：绝不降级
					if (notice) notice.hide();
					notify(t("You are using a development version"));
					return {
						...resultBase,
						status: "dev-version",
						fromVersion: localVersion,
					};
				}
			}

			if (notice) notice.hide();
			if (!silent) notice = new Notice(t("Downloading plugin files"), 0);

			// 2. 写入目录：已安装的用 Obsidian 记录的 dir（目录名可能不等于 id），
			//    未安装的才按 id 新建
			const pluginDir = PluginService.getPluginDir(
				app,
				installedId ?? pluginId,
			);
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

			// 4. 命中原旧 id 时迁移 community-plugins.json（不改用户的启用状态）
			const migrated = await PluginService.migrateLegacyPluginIdIfNeeded(
				app,
				{ remoteId: pluginId, legacyId, pluginDir },
			);
			if (migrated && !silent) {
				new Notice(
					`${t("Migrated plugin id")}: ${legacyId} → ${pluginId}`,
				);
			}

			// 5. 尝试重新加载插件：先刷新 manifest，然后禁用再启用
			// @ts-ignore 访问内部 API
			const plugins = app.plugins;
			if (autoReload) {
				try {
					if (plugins) {
						await PluginService.reloadAndEnablePlugin(
							app,
							pluginId,
						);

						notify(
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
					notify(
						`${t("Plugin")} "${manifest.name}" ${t(
							"installed/updated successfully",
						)}`,
					);
					notify(t("Plugin updated but reload failed"));
				}
			} else {
				notify(
					`${t("Plugin")} "${manifest.name}" ${t(
						"installed/updated successfully",
					)}`,
				);
			}

			return {
				...resultBase,
				status: "updated",
				fromVersion: localVersion,
			};
		} catch (error) {
			if (notice) notice.hide();
			console.error(t("Failed to install plugin") + ":", error);
			notify(t("Check console for details"));
			return {
				status: "failed",
				error: error?.message ?? String(error),
			};
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
			const response = await this.request({
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

	/**
	 * 带超时的 requestUrl：单请求超过 30s 直接判失败。
	 *
	 * 用 `Promise.race` + 定时器，结算后必须清掉定时器，
	 * 否则 Node 单测进程会被挂起的 timer 拖住。
	 */
	private static async request(options: any): Promise<any> {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new Error(
							`Request timed out after ${
								REQUEST_TIMEOUT_MS / 1000
							}s: ${options?.url ?? ""}`,
						),
					),
				REQUEST_TIMEOUT_MS,
			);
		});
		try {
			return await Promise.race([requestUrl(options), timeout]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private static async downloadAsset(url: string): Promise<string> {
		const response = await this.request({
			url: url,
			method: "GET",
		});
		return response.text;
	}
}
