# IOTO Plugins Center Tab 实现方案

## 需求背景

目前 IOTO Update 提供了 5 个通过命令面板（Command Palette）从 GitHub/Gitee 下载 IOTO 辅助插件的命令。这些命令入口较深，用户不易发现。需要在设置页新增一个 **Plugins Center** Tab，以列表形式展示所有可下载的 IOTO 辅助插件，显示安装状态并支持直接安装/更新。

## 仓库调研结论

### 现有可下载插件清单（来自 `command-service.ts`）

| 插件名（命令） | GitHub 仓库 | Gitee 仓库 | 特殊限制 |
|---|---|---|---|
| Install IOTO Template Generator | shawndotty/ioto-template-generator | johnnylearns/ioto-template-generator | 无 |
| Install Sync Scripts Generator | shawndotty/sync-script-generator | johnnylearns/sync-script-generator | 仅特定 viewID 用户可见 |
| Install IOTO Dashboard | shawndotty/ioto-dashboard | johnnylearns/ioto-dashboard | 无 |
| Install IOTO Tasks Center | shawndotty/ioto-tasks-center | johnnylearns/ioto-tasks-center | 无 |
| Install Text Popup | shawndotty/text-popup | johnnylearns/text-popup | 无 |

### 关键基础设施

- **设置 Tab 框架**：[settings-tab.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/ui/settings-tab.ts) 使用 `TabbedSettings.addTab(name, callback)` 注册标签页，现有 `Basic`、`IOTO_UPDATES`、`IOTO_TOTURIALS` 三个 Tab。
- **安装服务**：`GithubService.installPluginFrom(app, repoUrl, { autoReload })` 和 `GiteeService.installPluginFrom(...)` 已封装完整的下载-校验-写入-热重载流程。
- **版本检查**：`GithubService.getLatestPluginVersion(repoUrl)` / `GiteeService.getLatestPluginVersion(repoUrl)` 已能返回最新版本号，但**不返回 pluginId**。
- **已安装检测**：通过 `app.plugins.manifests[pluginId]` 读取已安装插件的 manifest（当前在 [github-service.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/services/github-service.ts#L95-L96) 中用 `// @ts-ignore` 访问，`types/index.ts` 未声明 `manifests` 字段）。
- **pluginId 获取**：pluginId 来自远程 `manifest.json` 的 `id` 字段，无法靠仓库名推断。因此"是否已安装"的判断必须先拉取远程 manifest 拿到 id，再比对本地 manifests。
- **i18n**：[lang/helpers.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/lang/helpers.ts) 的 `t()` 用 `keyof typeof en` 做类型检查，新增字符串必须在 `en.ts`、`zh-cn.ts`、`zh-tw.ts` 三份字典中同步添加。

### 设计约束

- 下载源选择遵循 `settings.pluginDownloadSource`（`github` / `gitee`）。
- SSG 插件的 viewID 白名单逻辑需与 `command-service.ts` 保持一致（`["viwZvtQy1GDWu00sA", "viwwopZSx1IGoTiJE"]`）。
- 安装后插件通过 `PluginService.reloadAndEnablePlugin` 热重载，无需整页 reload（除非失败）。

## 涉及文件与模块

| 文件 | 改动说明 |
|---|---|
| `src/types/index.ts` | 在 `App.plugins` 类型扩展中补充 `manifests` 字段，避免到处 `@ts-ignore` |
| `src/services/github-service.ts` | 新增 `getLatestPluginManifest(repoUrl)` 静态方法，返回 `{ id, name, version } \| null`；现有 `getLatestPluginVersion` 可复用它 |
| `src/services/gitee-service.ts` | 同上，新增 `getLatestPluginManifest(repoUrl)` |
| `src/services/plugin-registry.ts`（新建） | 导出 IOTO 辅助插件清单常量 `IOTO_PLUGINS`，含 name/desc 的 i18n key、githubUrl、giteeUrl、是否需 viewID 鉴权 |
| `src/ui/settings-tab.ts` | 在 `display()` 中新增 `Plugins Center` Tab，调用 `renderPluginsCenter()`；实现插件列表渲染、状态检测、安装/更新按钮逻辑 |
| `src/lang/locale/en.ts` | 新增 Plugins Center 相关文案 key |
| `src/lang/locale/zh-cn.ts` | 同步新增中文翻译 |
| `src/lang/locale/zh-tw.ts` | 同步新增繁体中文翻译 |
| `styles.css` | 为插件卡片列表添加样式（状态徽章、按钮布局等） |
| `src/services/command-service.ts` | （可选重构）复用 `plugin-registry.ts` 的仓库 URL，消除重复硬编码 |

## 实现步骤（依赖顺序）

### 步骤 1：扩展类型定义
在 `src/types/index.ts` 的 `App.plugins` 接口中增加：
```ts
manifests: {
    [key: string]: { id: string; name: string; version: string; [k: string]: any };
};
```

### 步骤 2：新增 `getLatestPluginManifest` 方法
**GithubService**：
- 新增静态方法 `getLatestPluginManifest(repoUrl): Promise<{ id: string; name: string; version: string } | null>`
- 复用内部 `getLatestRelease` + 下载 `manifest.json` asset，解析返回
- 将现有 `getLatestPluginVersion` 改为调用 `getLatestPluginManifest` 后返回 `.version`，减少重复代码

**GiteeService**：同理，复用 `getLatestRelease` + `getReleaseAssets` + `downloadAssetFromGitee`。

### 步骤 3：创建插件注册表 `plugin-registry.ts`
```ts
export interface IOTOPluginEntry {
    key: string;              // 唯一标识，用作 i18n key 前缀
    nameKey: string;          // 显示名称的 i18n key
    descKey: string;          // 描述的 i18n key
    githubUrl: string;
    giteeUrl: string;
    requireViewID?: boolean;  // 是否需要 viewID 白名单鉴权（SSG）
}

export const IOTO_PLUGINS: IOTOPluginEntry[] = [ ... ];
```
填入 5 个插件，`requireViewID` 仅对 sync-script-generator 为 `true`。

### 步骤 4：新增 i18n 文案
在三份语言文件中添加：
- `Plugins Center`（Tab 名）
- `Not installed`
- `Installed`
- `Update available`
- `Install`
- `Update`
- `Checking...`
- `Latest version`
- `Installed version`
- `Failed to check plugin info`
- `Retry`
- 5 个插件的名称 key（复用已有 `Install IOTO Template Generator` 等，或新增不带 "Install" 前缀的名称 key）
- 5 个插件的描述 key（如 `IOTO Template Generator.desc`）

注意：`t()` 的 key 必须是 `en.ts` 的键，插件描述 key 用点号（如 `"ioto-template-generator.desc"`）在 en.ts 中也是合法的对象键。

### 步骤 5：实现 `renderPluginsCenter`
在 `IOTOUpdateSettingTab` 中：
1. `display()` 里追加 `tabbedSettings.addTab(t("Plugins Center"), ...)`。
2. 新建 `renderPluginsCenter(containerEl)`：
   - 顶部加一个说明标题。
   - 遍历 `IOTO_PLUGINS`，对 `requireViewID` 的插件做白名单过滤（与 command-service 一致：`this.plugin.settings.updateIDs.iotoSettingPlugin?.viewID` 不在名单中则跳过或显示为"不可用"）。
   - 为每个插件创建一个卡片容器，渲染名称、描述。
   - 异步调用 `loadPluginStatus(entry)`：根据 `pluginDownloadSource` 选择 Github/Gitee 的 `getLatestPluginManifest`，拿到 `{ id, version }`，再从 `this.app.plugins.manifests[id]` 取已安装版本。
   - 状态展示：
     - 未安装 → 显示 "Not installed" + "Install" 按钮
     - 已安装且版本相同 → 显示 "Installed vX.X.X" + "Check for updates" 按钮
     - 已安装但有更新 → 显示 "Update available: vX.X.X → vY.Y.Y" + "Update" 按钮（CTA 样式）
     - 网络失败 → 显示错误 + "Retry" 按钮
   - 按钮点击：调用 `GithubService.installPluginFrom` / `GiteeService.installPluginFrom`，传入 `{ autoReload: true }`，安装成功后刷新该卡片状态。
   - 所有版本检查用 `Promise.all` 并行执行，带 loading 状态。

### 步骤 6：添加样式
在 `styles.css` 中为 `.ioto-plugin-card`、`.ioto-plugin-status`、`.ioto-plugin-actions` 等添加基础样式，与现有 Obsidian 主题变量（`var(--background-secondary)`、`var(--interactive-accent)` 等）保持一致。

### 步骤 7：（可选）重构 command-service.ts
将 `command-service.ts` 中 5 个安装命令的仓库 URL 改为从 `IOTO_PLUGINS` 读取，消除重复。保持命令行为不变。

## 依赖与注意事项

- **pluginId 依赖远程 manifest**：安装状态检测必须先联网获取 manifest 的 `id` 字段，因此首次打开 Tab 时有网络请求延迟，需用 loading 占位。
- **版本比较**：复用 `Utils.compareVersions(a, b)` 判断是否有更新（返回 `< 0` 表示有新版本）。
- **autoReload 行为**：`installPluginFrom` 默认 `autoReload: true`，会调用 `PluginService.reloadAndEnablePlugin` 热重载插件。安装 ioto-update 自身时用 `false`，但此处安装的是其他插件，用 `true` 即可。
- **viewID 白名单**：SSG 插件的可见性判断逻辑需从 `this.plugin.settings.updateIDs.iotoSettingPlugin?.viewID` 读取，与 command-service 完全一致。
- **并发安装**：不限制用户同时点多个安装按钮，但 Obsidian 插件热重载可能有竞争。初期不做互斥，观察实际情况。
- **命令兼容性**：保留原有的命令面板安装命令，Plugins Center 是新增入口，不删除旧命令。

## 验证方式

1. `npm run build` 通过 TypeScript 类型检查与 esbuild 打包。
2. 在 Obsidian 中加载插件，打开设置页，确认出现 "Plugins Center" Tab。
3. 验证 5 个插件（或 4 个，若 viewID 不匹配）均正确显示名称、描述。
4. 对一个未安装的插件点击 Install，确认下载、安装、热重载成功，状态刷新为 "Installed"。
5. 对一个已安装且非最新的插件点击 Update，确认更新成功。
6. 切换 `Plugin Download Source` 为 Gitee，重复验证安装流程。
7. 断网状态下打开 Tab，确认显示错误状态与 Retry 按钮，不崩溃。
8. 切换中英文语言，确认所有新增文案正确显示。

## 风险与处理

| 风险 | 处理 |
|---|---|
| `app.plugins.manifests` 类型未公开 | 在 `types/index.ts` 中补充声明，统一替代 `@ts-ignore` |
| 远程 manifest 拉取失败导致状态未知 | 显示 "Failed to check" + Retry 按钮，不阻塞其他插件 |
| 安装时热重载失败 | `installPluginFrom` 已有 try/catch 并提示用户手动重启，沿用即可 |
| SSG viewID 逻辑与命令不一致 | 抽取公共判断逻辑到 `plugin-registry` 或工具函数，两处共用 |
| 插件列表后续新增 | 只需在 `IOTO_PLUGINS` 数组追加一项 + 三份语言文件加 key，无需改其他代码 |
