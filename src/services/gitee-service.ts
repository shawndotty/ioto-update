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

export class GiteeService {
	/**
	 * 远程 manifest 信息的内存缓存，避免频繁请求 Gitee API。
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

	/**
	 * 从 Gitee 仓库地址安装或更新插件
	 * @param app Obsidian App 实例
	 * @param repoUrl Gitee 仓库地址（例如：https://gitee.com/owner/repo 或 owner/repo）
	 * @param options 可选安装行为参数。
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
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) {
				notify(t("Invalid Gitee repository URL"));
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
			// 内部会先尝试 Gitee API，失败时降级到 releases 页面抓取 tag 后直接下载，
			// 与 getLatestPluginManifest 的限流降级策略保持一致。
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

			// 本地版本以磁盘为准（内存 manifests 可能滞后）；未安装时不做版本比较
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

			// 写入目录：已安装的用 Obsidian 记录的 dir（目录名可能不等于 id），
			// 未安装的才按 id 新建
			const pluginDir = PluginService.getPluginDir(
				app,
				installedId ?? pluginId,
			);
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(pluginDir))) {
				await adapter.mkdir(pluginDir);
			}

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

			// 命中原旧 id 时迁移 community-plugins.json（不改用户的启用状态）
			const migrated = await PluginService.migrateLegacyPluginIdIfNeeded(
				app,
				{ remoteId: pluginId, legacyId, pluginDir },
			);
			if (migrated && !silent) {
				new Notice(
					`${t("Migrated plugin id")}: ${legacyId} → ${pluginId}`,
				);
			}

			// 尝试重新加载插件
			// @ts-ignore
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
	 * 优先使用 Gitee API；当 API 限流或返回为空时降级到 releases 页面：
	 * 解析出最新 release 的 tag，再通过 releases/download/{tag}/{file} 直接下载。
	 *
	 * 注意：不使用 master 分支的 raw 文件作为安装来源，避免安装未发布的代码。
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
		// 方案 1：Gitee API（成功则直接返回；失败/限流/无 release 则降级）
		try {
			const release = await this.getLatestRelease(owner, repo);
			if (release) {
				const assets = await this.getReleaseAssets(
					owner,
					repo,
					release.id,
				);
				if (assets && Array.isArray(assets)) {
					const manifestAsset = assets.find(
						(a: any) => a.name === "manifest.json",
					);
					const mainJsAsset = assets.find(
						(a: any) => a.name === "main.js",
					);
					const stylesCssAsset = assets.find(
						(a: any) => a.name === "styles.css",
					);
					if (manifestAsset && mainJsAsset) {
						const manifestContent = await this.downloadAssetFromGitee(
							manifestAsset,
							owner,
							repo,
							release,
						);
						const mainJsContent = await this.downloadAssetFromGitee(
							mainJsAsset,
							owner,
							repo,
							release,
						);
						let stylesCssContent = "";
						if (stylesCssAsset) {
							stylesCssContent = await this.downloadAssetFromGitee(
								stylesCssAsset,
								owner,
								repo,
								release,
							);
						}
						return {
							manifestContent,
							mainJsContent,
							stylesCssContent,
						};
					}
				}
			}
		} catch (apiErr) {
			console.warn(
				"Gitee API failed during install, trying releases page fallback:",
				apiErr,
			);
		}

		// 方案 2：API 失败（限流/无 release）时，抓取 releases 页面获取最新 tag，
		// 然后直接从 release 下载文件
		try {
			const tag = await this.getLatestReleaseTagFromPage(owner, repo);
			if (!tag) return null;

			const baseUrl = `https://gitee.com/${owner}/${repo}/releases/download/${tag}`;
			const manifestContent = await this.downloadRawText(
				`${baseUrl}/manifest.json`,
			);
			if (!manifestContent) return null;

			const mainJsContent = await this.downloadRawText(
				`${baseUrl}/main.js`,
			);
			if (!mainJsContent) return null;

			// styles.css 可选，不存在时静默跳过
			let stylesCssContent = "";
			const stylesCssTmp = await this.downloadRawText(
				`${baseUrl}/styles.css`,
			);
			if (stylesCssTmp) {
				stylesCssContent = stylesCssTmp;
			}

			return { manifestContent, mainJsContent, stylesCssContent };
		} catch (fallbackErr) {
			console.error(
				"Both API and fallback failed for fetching plugin files:",
				fallbackErr,
			);
			return null;
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

			let manifestContent: string | null = null;

			// 方案 1：优先尝试 Gitee API 获取最新 release 的 manifest
			try {
				const release = await this.getLatestRelease(
					repoInfo.owner,
					repoInfo.repo,
				);
				if (release) {
					const assets = await this.getReleaseAssets(
						repoInfo.owner,
						repoInfo.repo,
						release.id,
					);
					const manifestAsset = assets?.find(
						(a: any) => a.name === "manifest.json",
					);
					if (manifestAsset) {
						manifestContent = await this.downloadAssetFromGitee(
							manifestAsset,
							repoInfo.owner,
							repoInfo.repo,
							release,
						);
					}
				}
			} catch (apiErr) {
				console.warn(
					"Gitee API failed, trying releases page fallback:",
					apiErr,
				);
			}

			// 方案 2：API 失败（如限流）时，抓取 releases 页面获取最新 tag，
			// 再从该 release 下载 manifest.json，确保拿到的是真正发布的版本
			if (!manifestContent) {
				const tag = await this.getLatestReleaseTagFromPage(
					repoInfo.owner,
					repoInfo.repo,
				);
				if (tag) {
					const releaseUrl = `https://gitee.com/${repoInfo.owner}/${repoInfo.repo}/releases/download/${tag}/manifest.json`;
					manifestContent = await this.downloadRawText(releaseUrl);
				}
			}

			// 方案 3：以上均失败时，最后 fallback 到 master 分支的 raw manifest.json
			if (!manifestContent) {
				const rawUrl = `https://gitee.com/${repoInfo.owner}/${repoInfo.repo}/raw/master/manifest.json`;
				manifestContent = await this.downloadRawText(rawUrl);
			}

			if (!manifestContent) return null;
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
	 * 抓取 Gitee releases 页面 HTML，解析出最新 release 的 tag。
	 * Gitee 不提供类似 GitHub 的 releases/latest/download 重定向链接，
	 * 此方法作为 API 限流时的替代方案，避免直接使用 master 分支（可能不是发布版本）。
	 */
	private static async getLatestReleaseTagFromPage(
		owner: string,
		repo: string,
	): Promise<string | null> {
		try {
			const url = `https://gitee.com/${owner}/${repo}/releases`;
			const html = await this.downloadRawText(url);
			if (!html) return null;
			// releases 页面中第一个 releases/download/{tag}/ 即为最新版本
			const match = html.match(/releases\/download\/([^\/"'<>\s]+)\//);
			return match ? match[1] : null;
		} catch (e) {
			console.error("Failed to parse Gitee releases page:", e);
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
		// 支持 https://gitee.com/owner/repo 或 owner/repo
		const regex = /gitee\.com\/([^\/]+)\/([^\/]+)/;
		const match = url.match(regex);
		if (match) {
			return { owner: match[1], repo: match[2].replace(".git", "") };
		}
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
		const url = `https://gitee.com/api/v5/repos/${owner}/${repo}/releases/latest`;
		try {
			const response = await this.request({
				url,
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			});
			if (response.status === 200) {
				return response.json;
			}
		} catch (e) {
			console.error("Error fetching Gitee release:", e);
		}
		return null;
	}

	private static async getReleaseAssets(
		owner: string,
		repo: string,
		releaseId: number,
	): Promise<any[] | null> {
		const url = `https://gitee.com/api/v5/repos/${owner}/${repo}/releases/${releaseId}/attach_files`;
		try {
			const response = await this.request({
				url,
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			});
			if (response.status === 200) {
				return response.json;
			}
		} catch (e) {
			console.error("Error fetching Gitee attach files:", e);
		}
		return null;
	}

	private static async downloadAssetFromGitee(
		asset: any,
		owner: string,
		repo: string,
		release: any,
	): Promise<string> {
		// 优先使用 API 返回的下载链接
		const url =
			asset.browser_download_url ||
			asset.download_url ||
			asset.url ||
			(release?.tag_name
				? `https://gitee.com/${owner}/${repo}/releases/download/${release.tag_name}/${asset.name}`
				: undefined);
		if (!url) {
			throw new Error(
				"No available download url for asset: " + asset?.name,
			);
		}
		const response = await this.request({
			url,
			method: "GET",
		});
		return response.text;
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

	/**
	 * 直接下载文本文件内容（用于 fallback 到 raw URL）。
	 */
	private static async downloadRawText(url: string): Promise<string | null> {
		try {
			const response = await this.request({
				url,
				method: "GET",
			});
			if (response.status === 200) {
				return response.text;
			}
		} catch (e) {
			console.error("Error downloading raw text:", e);
		}
		return null;
	}
}
