import { App, Notice, requestUrl } from "obsidian";
import { t } from "../lang/helpers";

export class GiteeService {
	/**
	 * 从 Gitee 仓库地址安装或更新插件
	 * @param app Obsidian App 实例
	 * @param repoUrl Gitee 仓库地址（例如：https://gitee.com/owner/repo 或 owner/repo）
	 */
	static async installPluginFrom(app: App, repoUrl: string): Promise<void> {
		let notice: Notice | null = null;
		try {
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) {
				new Notice(t("Invalid Gitee repository URL"));
				return;
			}
			const { owner, repo } = repoInfo;

			notice = new Notice(`${t("Checking for updates from")} ${owner}/${repo}...`, 0);

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

			const manifestAsset = assets.find((a: any) => a.name === "manifest.json");
			const mainJsAsset = assets.find((a: any) => a.name === "main.js");
			const stylesCssAsset = assets.find((a: any) => a.name === "styles.css");

			if (!manifestAsset || !mainJsAsset) {
				if (notice) notice.hide();
				new Notice(
					t("Release is missing manifest.json or main.js. Cannot install."),
				);
				return;
			}

			if (notice) notice.hide();
			notice = new Notice(t("Downloading manifest"), 0);

			const manifestContent = await this.downloadAssetFromGitee(manifestAsset, owner, repo, release);
			const manifest = JSON.parse(manifestContent);
			const pluginId = manifest.id;

			if (!pluginId) {
				if (notice) notice.hide();
				new Notice(t("Invalid manifest.json: missing 'id' field"));
				return;
			}

			// @ts-ignore
			const installedPlugin = app.plugins.manifests?.[pluginId];
			if (installedPlugin && installedPlugin.version === manifest.version) {
				if (notice) notice.hide();
				new Notice(`${t("Plugin")} "${manifest.name}" ${t("is already up to date")}`);
				return;
			}

			if (notice) notice.hide();
			notice = new Notice(t("Downloading plugin files"), 0);

			const mainJsContent = await this.downloadAssetFromGitee(mainJsAsset, owner, repo, release);
			let stylesCssContent = "";
			if (stylesCssAsset) {
				stylesCssContent = await this.downloadAssetFromGitee(stylesCssAsset, owner, repo, release);
			}

			const pluginDir = `${app.vault.configDir}/plugins/${pluginId}`;
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(pluginDir))) {
				await adapter.mkdir(pluginDir);
			}

			await adapter.write(`${pluginDir}/manifest.json`, manifestContent);
			await adapter.write(`${pluginDir}/main.js`, mainJsContent);
			if (stylesCssContent) {
				await adapter.write(`${pluginDir}/styles.css`, stylesCssContent);
			}

			if (notice) notice.hide();

			// 尝试重新加载插件
			// @ts-ignore
			const plugins = app.plugins;
			try {
				if (plugins) {
					// @ts-ignore
					if (plugins.loadManifests) {
						// @ts-ignore
						await plugins.loadManifests();
					}
					// @ts-ignore
					if (plugins.enabledPlugins.has(pluginId)) {
						// @ts-ignore
						await plugins.disablePlugin(pluginId);
					}
					// @ts-ignore
					await plugins.enablePlugin(pluginId);
					new Notice(
						`${t("Plugin")} "${manifest.name}" ${t("installed/updated successfully")} & ${t("reloaded")}`,
					);
				}
			} catch (reloadErr) {
				console.warn(t("Automatic reload failed") + ":", reloadErr);
				new Notice(
					`${t("Plugin")} "${manifest.name}" ${t("installed/updated successfully")}`,
				);
				new Notice(t("Plugin updated but reload failed"));
			}
		} catch (error) {
			if (notice) notice.hide();
			console.error(t("Failed to install plugin") + ":", error);
			new Notice(t("Check console for details"));
		}
	}

	static async getLatestPluginVersion(repoUrl: string): Promise<string | null> {
		try {
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) return null;
			const release = await this.getLatestRelease(repoInfo.owner, repoInfo.repo);
			if (!release) return null;
			const assets = await this.getReleaseAssets(repoInfo.owner, repoInfo.repo, release.id);
			const manifestAsset = assets?.find((a: any) => a.name === "manifest.json");
			if (!manifestAsset) return null;
			const manifestContent = await this.downloadAssetFromGitee(
				manifestAsset,
				repoInfo.owner,
				repoInfo.repo,
				release,
			);
			const manifest = JSON.parse(manifestContent);
			return manifest.version;
		} catch (error) {
			console.error("Failed to check for updates:", error);
			return null;
		}
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

	private static async getLatestRelease(owner: string, repo: string): Promise<any> {
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

	private static async getReleaseAssets(owner: string, repo: string, releaseId: number): Promise<any[] | null> {
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

	private static async downloadAssetFromGitee(asset: any, owner: string, repo: string, release: any): Promise<string> {
		// 优先使用 API 返回的下载链接
		const url =
			asset.browser_download_url ||
			asset.download_url ||
			asset.url ||
			(release?.tag_name
				? `https://gitee.com/${owner}/${repo}/releases/download/${release.tag_name}/${asset.name}`
				: undefined);
		if (!url) {
			throw new Error("No available download url for asset: " + asset?.name);
		}
		const response = await requestUrl({
			url,
			method: "GET",
		});
		return response.text;
	}
}

