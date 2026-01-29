import { App, Notice, requestUrl } from "obsidian";
import { t } from "../lang/helpers";

export class GithubService {
	/**
	 * Installs or updates a plugin from a GitHub repository URL.
	 * @param app The Obsidian App instance
	 * @param repoUrl The GitHub repository URL (e.g., https://github.com/owner/repo)
	 */
	static async installPluginFrom(app: App, repoUrl: string): Promise<void> {
		try {
			// 1. Parse the repository URL
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) {
				new Notice(t("Invalid GitHub repository URL"));
				return;
			}
			const { owner, repo } = repoInfo;

			new Notice(`${t("Checking for updates from")} ${owner}/${repo}...`);

			// 2. Fetch the latest release
			const release = await this.getLatestRelease(owner, repo);
			if (!release) {
				new Notice(t("No release found for this repository"));
				return;
			}

			// 3. Find necessary assets (main.js, manifest.json, styles.css)
			const manifestAsset = release.assets.find(
				(a: any) => a.name === "manifest.json",
			);
			const mainJsAsset = release.assets.find(
				(a: any) => a.name === "main.js",
			);
			const stylesCssAsset = release.assets.find(
				(a: any) => a.name === "styles.css",
			);

			if (!manifestAsset || !mainJsAsset) {
				new Notice(
					t(
						"Release is missing manifest.json or main.js. Cannot install.",
					),
				);
				return;
			}

			// 4. Download manifest first to get the plugin ID
			const manifestContent = await this.downloadAsset(
				manifestAsset.browser_download_url,
			);
			const manifest = JSON.parse(manifestContent);
			const pluginId = manifest.id;

			if (!pluginId) {
				new Notice(t("Invalid manifest.json: missing 'id' field"));
				return;
			}

			// Check if plugin is already installed and up to date
			// @ts-ignore
			const installedPlugin = app.plugins.manifests?.[pluginId];
			if (
				installedPlugin &&
				installedPlugin.version === manifest.version
			) {
				new Notice(
					`${t("Plugin")} "${manifest.name}" ${t("is already up to date")}`,
				);
				return;
			}

			// 5. Download other files
			const mainJsContent = await this.downloadAsset(
				mainJsAsset.browser_download_url,
			);
			let stylesCssContent = "";
			if (stylesCssAsset) {
				stylesCssContent = await this.downloadAsset(
					stylesCssAsset.browser_download_url,
				);
			}

			// 6. Ensure plugin directory exists
			// app.vault.configDir usually is ".obsidian"
			const pluginDir = `${app.vault.configDir}/plugins/${pluginId}`;
			const adapter = app.vault.adapter;

			if (!(await adapter.exists(pluginDir))) {
				await adapter.mkdir(pluginDir);
			}

			// 7. Write files
			await adapter.write(`${pluginDir}/manifest.json`, manifestContent);
			await adapter.write(`${pluginDir}/main.js`, mainJsContent);
			if (stylesCssContent) {
				await adapter.write(
					`${pluginDir}/styles.css`,
					stylesCssContent,
				);
			}

			// 尝试重新加载插件：先刷新 manifest，然后禁用再启用
			// @ts-ignore 访问内部 API
			const plugins = app.plugins;
			try {
				if (plugins) {
					// 1. 刷新插件列表，确保 Obsidian 识别到新下载的插件
					// @ts-ignore
					if (plugins.loadManifests) {
						// @ts-ignore
						await plugins.loadManifests();
					}

					// 2. 如果插件已启用，先禁用
					// @ts-ignore
					if (plugins.enabledPlugins.has(pluginId)) {
						// @ts-ignore
						await plugins.disablePlugin(pluginId);
					}

					// 3. 启用插件
					// @ts-ignore
					await plugins.enablePlugin(pluginId);

					new Notice(
						`${t("Plugin")} "${manifest.name}" ${t(
							"installed/updated successfully",
						)} & ${t("reloaded")}`,
					);
				}
			} catch (reloadErr) {
				console.warn(t("Automatic reload failed") + ":", reloadErr);
				new Notice(
					`${t("Plugin")} "${manifest.name}" ${t(
						"installed/updated successfully",
					)}`,
				);
				new Notice(t("Plugin updated but reload failed"));
			}

			// Optional: Reload plugins logic could go here, but usually requires user action or internal API usage
			// For now, just notifying is safer.
		} catch (error) {
			console.error(t("Failed to install plugin") + ":", error);
			new Notice(t("Check console for details"));
		}
	}

	static async getLatestPluginVersion(
		repoUrl: string,
	): Promise<string | null> {
		try {
			const repoInfo = this.parseRepoUrl(repoUrl);
			if (!repoInfo) return null;
			const release = await this.getLatestRelease(
				repoInfo.owner,
				repoInfo.repo,
			);
			if (!release) return null;

			const manifestAsset = release.assets.find(
				(a: any) => a.name === "manifest.json",
			);
			if (!manifestAsset) return null;

			const manifestContent = await this.downloadAsset(
				manifestAsset.browser_download_url,
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
