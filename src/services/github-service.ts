import { App, Notice, requestUrl } from "obsidian";

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
				new Notice("Invalid GitHub repository URL");
				return;
			}
			const { owner, repo } = repoInfo;

			new Notice(`Checking for updates from ${owner}/${repo}...`);

			// 2. Fetch the latest release
			const release = await this.getLatestRelease(owner, repo);
			if (!release) {
				new Notice("No release found for this repository");
				return;
			}

			// 3. Find necessary assets (main.js, manifest.json, styles.css)
			const manifestAsset = release.assets.find(
				(a: any) => a.name === "manifest.json"
			);
			const mainJsAsset = release.assets.find(
				(a: any) => a.name === "main.js"
			);
			const stylesCssAsset = release.assets.find(
				(a: any) => a.name === "styles.css"
			);

			if (!manifestAsset || !mainJsAsset) {
				new Notice(
					"Release is missing manifest.json or main.js. Cannot install."
				);
				return;
			}

			// 4. Download manifest first to get the plugin ID
			const manifestContent = await this.downloadAsset(manifestAsset.browser_download_url);
			const manifest = JSON.parse(manifestContent);
			const pluginId = manifest.id;

			if (!pluginId) {
				new Notice("Invalid manifest.json: missing 'id' field");
				return;
			}

			// 5. Download other files
			const mainJsContent = await this.downloadAsset(mainJsAsset.browser_download_url);
			let stylesCssContent = "";
			if (stylesCssAsset) {
				stylesCssContent = await this.downloadAsset(stylesCssAsset.browser_download_url);
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
				await adapter.write(`${pluginDir}/styles.css`, stylesCssContent);
			}

			new Notice(
				`Plugin "${manifest.name}" (${pluginId}) installed/updated successfully!`
			);
            
            // Optional: Reload plugins logic could go here, but usually requires user action or internal API usage
            // For now, just notifying is safer.
		} catch (error) {
			console.error("Failed to install plugin:", error);
			new Notice("Failed to install plugin. Check console for details.");
		}
	}

	private static parseRepoUrl(url: string): { owner: string; repo: string } | null {
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

	private static async getLatestRelease(owner: string, repo: string): Promise<any> {
		const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
		try {
			const response = await requestUrl({
				url: url,
				method: "GET",
				headers: {
					"Accept": "application/vnd.github.v3+json"
				}
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
			method: "GET"
		});
		return response.text;
	}
}
