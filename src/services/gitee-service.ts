import { App, Notice, requestUrl } from "obsidian";
import { t } from "../lang/helpers";
import { PluginService } from "./plugin-service";
import { InstallPluginOptions } from "./github-service";

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
	 */
	static async installPluginFrom(
		app: App,
		repoUrl: string,
		options: InstallPluginOptions = {},
	): Promise<void> {
		const { autoReload = true } = options;
		let notice: Notice | null = null;
		try {
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) {
				new Notice(t("Invalid Gitee repository URL"));
				return;
			}
			const { owner, repo } = repoInfo;

			notice = new Notice(
				`${t("Checking for updates from")} ${owner}/${repo}...`,
				0,
			);

			const release = await this.getLatestRelease(owner, repo);
			if (!release) {
				if (notice) notice.hide();
				new Notice(t("No release found for this repository"));
				return;
			}

			// 获取附件列表（包含 manifest.json / main.js / styles.css）
			const assets = await this.getReleaseAssets(owner, repo, release.id);
			if (!assets || !Array.isArray(assets)) {
				if (notice) notice.hide();
				new Notice(t("No release found for this repository"));
				return;
			}

			const manifestAsset = assets.find(
				(a: any) => a.name === "manifest.json",
			);
			const mainJsAsset = assets.find((a: any) => a.name === "main.js");
			const stylesCssAsset = assets.find(
				(a: any) => a.name === "styles.css",
			);

			if (!manifestAsset || !mainJsAsset) {
				if (notice) notice.hide();
				new Notice(
					t(
						"Release is missing manifest.json or main.js. Cannot install.",
					),
				);
				return;
			}

			if (notice) notice.hide();
			notice = new Notice(t("Downloading manifest"), 0);

			const manifestContent = await this.downloadAssetFromGitee(
				manifestAsset,
				owner,
				repo,
				release,
			);
			const manifest = JSON.parse(manifestContent);
			const pluginId = manifest.id;

			if (!pluginId) {
				if (notice) notice.hide();
				new Notice(t("Invalid manifest.json: missing 'id' field"));
				return;
			}

			// @ts-ignore
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

			const pluginDir = `${app.vault.configDir}/plugins/${pluginId}`;
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(pluginDir))) {
				await adapter.mkdir(pluginDir);
			}

			await adapter.write(`${pluginDir}/manifest.json`, manifestContent);
			await adapter.write(`${pluginDir}/main.js`, mainJsContent);
			if (stylesCssContent) {
				await adapter.write(
					`${pluginDir}/styles.css`,
					stylesCssContent,
				);
			}

			if (notice) notice.hide();

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
			const response = await requestUrl({
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
			const response = await requestUrl({
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
		const response = await requestUrl({
			url,
			method: "GET",
		});
		return response.text;
	}

	/**
	 * 直接下载文本文件内容（用于 fallback 到 raw URL）。
	 */
	private static async downloadRawText(url: string): Promise<string | null> {
		try {
			const response = await requestUrl({
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
