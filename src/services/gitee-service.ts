import { App, Notice, requestUrl } from "obsidian";
import { t } from "../lang/helpers";
import { Utils } from "../utils";
import {
	InstallPluginOptions,
	InstallPluginResult,
	UpdateChannel,
} from "./install-types";
import { PluginService } from "./plugin-service";

/** 单次网络请求超时：超过即判失败，避免 11 个插件串行时被一个卡死的请求拖住。 */
const REQUEST_TIMEOUT_MS = 30 * 1000;

/** 版本检测失败提示的最小间隔：10 秒内只提示一次，避免 11 插件循环刷屏。 */
const FAILURE_NOTICE_TTL = 10 * 1000;

export class GiteeService {
	/**
	 * 远程 manifest 信息的内存缓存，避免频繁请求 Gitee API。
	 * key 为 `${repoUrl}|${channel}`（通道必须隔离，否则先查正式版再查预发布会拿到错版本），
	 * value 为 { data, timestamp }。
	 * 只缓存 API / HTML 成功拿到的 manifest；失败路径不写缓存，避免旧值固化 10 分钟。
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
	 * API 成功时回填的 tag → 是否预发布映射，供 HTML fallback 的正式通道排除预发布 tag。
	 * key 带 `owner/repo|` 前缀，避免不同仓库的同名 tag 互相污染。
	 */
	private static tagPrereleaseMap = new Map<string, boolean>();

	/** 上一次版本检测失败提示的时间，用于 10 秒去重。 */
	private static lastFailureNoticeAt = 0;

	/**
	 * 清除指定仓库的 manifest 缓存与派生状态（两个通道都清）；
	 * 若不传 repoUrl 则清除全部。手动刷新时调用，确保下一轮检测拿到的是当前真相。
	 */
	static clearManifestCache(repoUrl?: string) {
		if (repoUrl) {
			this.manifestCache.delete(`${repoUrl}|stable`);
			this.manifestCache.delete(`${repoUrl}|prerelease`);
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (repoInfo) {
				const prefix = `${repoInfo.owner}/${repoInfo.repo}|`;
				for (const key of this.tagPrereleaseMap.keys()) {
					if (key.startsWith(prefix)) this.tagPrereleaseMap.delete(key);
				}
			}
		} else {
			this.manifestCache.clear();
			this.tagPrereleaseMap.clear();
		}
		this.lastFailureNoticeAt = 0;
	}

	private static tagKey(owner: string, repo: string, tag: string): string {
		return `${owner}/${repo}|${tag}`;
	}

	/** Gitee 检测失败时给一次可见提示（10 秒去重，避免循环刷屏）。 */
	private static notifyVersionCheckFailed(): void {
		const now = Date.now();
		if (now - this.lastFailureNoticeAt < FAILURE_NOTICE_TTL) return;
		this.lastFailureNoticeAt = now;
		new Notice(t("Gitee version check failed"));
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
		const { autoReload = true, silent = false, channel = "stable" } = options;
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
			// 内部按通道从 release 列表选版，失败时降级到 releases 页面抓取 tag 后直接下载，
			// 与 getLatestPluginManifest 的限流降级策略保持一致。
			const files = await this.fetchPluginReleaseFiles(
				owner,
				repo,
				channel,
			);
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
		channel: UpdateChannel = "stable",
	): Promise<{
		manifestContent: string;
		mainJsContent: string;
		stylesCssContent: string;
	} | null> {
		// 方案 1：Gitee API（成功则直接返回；失败/限流/无 release 则降级）
		try {
			const release = await this.getLatestRelease(owner, repo, channel);
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
			const tag = await this.getLatestReleaseTagFromPage(owner, repo, channel);
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
		channel: UpdateChannel = "stable",
	): Promise<{ id: string; name: string; version: string } | null> {
		const cacheKey = `${repoUrl}|${channel}`;
		// 优先读取缓存，未过期则直接返回
		const cached = this.manifestCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
			return cached.data;
		}

		try {
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) return null;

			let manifestContent: string | null = null;
			// 只有 API 成功拿到的 manifest 才写缓存；HTML fallback 结果每次重新检测，
			// 避免限流期的临时错值被固化 10 分钟。
			let fromApi = false;

			// 方案 1：优先尝试 Gitee API 获取最新 release 的 manifest
			try {
				const release = await this.getLatestRelease(
					repoInfo.owner,
					repoInfo.repo,
					channel,
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
						fromApi = Boolean(manifestContent);
					}
				}
			} catch (apiErr) {
				this.notifyVersionCheckFailed();
				console.warn(
					"Gitee API failed, trying releases page fallback:",
					apiErr,
				);
			}

			// 方案 2：API 失败（如限流）时，抓取 releases 页面获取最新 tag，
			// 再从该 release 下载 manifest.json，确保拿到的是真正发布的版本。
			// Gitee releases 页没有可判读的预发布标记，正式通道的排除依据来自
			// getLatestRelease 在 API 成功时回填的 tagPrereleaseMap。
			if (!manifestContent) {
				const tag = await this.getLatestReleaseTagFromPage(
					repoInfo.owner,
					repoInfo.repo,
					channel,
				);
				if (tag) {
					const releaseUrl = `https://gitee.com/${repoInfo.owner}/${repoInfo.repo}/releases/download/${tag}/manifest.json`;
					manifestContent = await this.downloadRawText(releaseUrl);
				}
			}

			// master 分支不再参与版本检测：API 与 releases 页面都失败时，
			// 明确提示并 fail-closed，不给用户一个看似合理但实则滞后的旧版本号。
			if (!manifestContent) {
				this.notifyVersionCheckFailed();
				return null;
			}
			const manifest = JSON.parse(manifestContent);
			if (!manifest || !manifest.id) return null;

			const result = {
				id: manifest.id,
				name: manifest.name || manifest.id,
				version: manifest.version,
			};
			if (fromApi) {
				this.manifestCache.set(cacheKey, {
					data: result,
					timestamp: Date.now(),
				});
			}
			return result;
		} catch (error) {
			console.error("Failed to fetch latest plugin manifest:", error);
			return null;
		}
	}

	/**
	 * 抓取 Gitee releases 页面 HTML，按通道解析出合适的 tag。
	 * Gitee 不提供类似 GitHub 的 releases/latest/download 重定向链接，
	 * 此方法作为 API 限流时的替代方案，master 分支绝不参与版本检测。
	 *
	 * 实测 releases 页与单条 release 页都没有「预发布 / prerelease」文本标记，
	 * tag 也是纯 `vX.Y.Z`，所以不能靠上下文正则判预发布：
	 * - 预发布通道：按 tag 版本号降序取最大者，下载它的 manifest 复核可用后返回该 tag；
	 * - 正式通道：只从 tagPrereleaseMap（API 成功时回填）中已知的正式 tag 里取最大者，
	 *   Map 为空或无候选时 fail-closed 返回 null，不猜测、不回退 master。
	 */
	private static async getLatestReleaseTagFromPage(
		owner: string,
		repo: string,
		channel: UpdateChannel = "stable",
	): Promise<string | null> {
		try {
			const url = `https://gitee.com/${owner}/${repo}/releases`;
			const html = await this.downloadRawText(url);
			if (!html) return null;

			const seen = new Set<string>();
			const tags: string[] = [];
			for (const match of html.matchAll(
				/releases\/download\/([^\/"'<>\s]+)\//g,
			)) {
				const tag = match[1];
				if (seen.has(tag)) continue;
				seen.add(tag);
				tags.push(tag);
			}
			if (tags.length === 0) return null;

			// 剥离 v 前缀后按语义化版本降序，不依赖页面出现顺序。
			tags.sort((a, b) =>
				Utils.compareVersions(
					b.replace(/^v/i, ""),
					a.replace(/^v/i, ""),
				),
			);

			if (channel === "prerelease") {
				// 复核该 tag 确实有可下载的 manifest，避免选到信息不完整的 release。
				for (const tag of tags) {
					const manifestUrl = `https://gitee.com/${owner}/${repo}/releases/download/${tag}/manifest.json`;
					if (await this.downloadRawText(manifestUrl)) return tag;
				}
				return null;
			}

			// 正式通道：只认 API 曾明确标记为非预发布的 tag，不能把预发布当正式版。
			const stableTags = tags.filter(
				(tag) =>
					this.tagPrereleaseMap.get(this.tagKey(owner, repo, tag)) ===
					false,
			);
			return stableTags[0] ?? null;
		} catch (e) {
			console.error("Failed to parse Gitee releases page:", e);
			return null;
		}
	}

	static async getLatestPluginVersion(
		repoUrl: string,
		channel: UpdateChannel = "stable",
	): Promise<string | null> {
		const manifest = await this.getLatestPluginManifest(repoUrl, channel);
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

	/**
	 * 按通道选 release：
	 * - prerelease：只取 prerelease === true；
	 * - stable：显式排除 prerelease（Gitee `/releases/latest` 会把预发布当最新，
	 *   直接用会让正式用户也被装到预发布）。
	 * API 返回单个对象（旧桩/边界）时按同一判据放行。
	 */
	private static async getLatestRelease(
		owner: string,
		repo: string,
		channel: UpdateChannel = "stable",
	): Promise<any> {
		// Gitee 的 /releases 默认按创建时间「升序」返回（最旧在前），
		// 不带 direction=desc 时 per_page=20 只会拿到最旧 20 条，
		// 最新预发布/正式版根本不在其中：预发布用户取不到预发布，
		// 正式用户反而会被装到最旧的非预发布版本。必须显式降序。
		const url = `https://gitee.com/api/v5/repos/${owner}/${repo}/releases?per_page=20&direction=desc`;
		try {
			const response = await this.request({
				url,
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			});
			if (response.status === 403) {
				this.notifyVersionCheckFailed();
				return null;
			}
			if (response.status !== 200) return null;
			const data = response.json;

			// API 成功时顺手记录全部 tag 的预发布标记，供 HTML fallback 的正式通道
			// 排除预发布 tag；403 等失败路径不写，避免用不确定的旧标记误导。
			const releases = Array.isArray(data) ? data : data ? [data] : [];

			for (const release of releases) {
				if (release?.tag_name) {
					this.tagPrereleaseMap.set(
						this.tagKey(owner, repo, release.tag_name),
						release.prerelease === true,
					);
				}
			}

			const matches = (release: any) =>
				channel === "prerelease"
					? release?.prerelease === true
					: release?.prerelease !== true;
			if (!Array.isArray(data)) {
				return matches(data) ? data : null;
			}
			const candidates = data.filter(matches);
			candidates.sort((a: any, b: any) => {
				const ta = Date.parse(a.created_at || "") || 0;
				const tb = Date.parse(b.created_at || "") || 0;
				if (ta !== tb) return tb - ta;
				return (b.id || 0) - (a.id || 0);
			});
			return candidates[0] ?? null;
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
