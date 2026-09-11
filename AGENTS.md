# IOTO Update 插件 - AI Agent 开发指南

## 项目概述

**IOTO Update** 是一个 Obsidian 插件，用于在 Obsidian 内部更新 IOTO 框架、部署 AI Agent 技能、安装配套插件以及同步个人模板。版本号为 `2.2.5`。

### 主要功能模块

1. **IOTO 框架更新**：从 Airtable/NocoDB 同步核心文件、帮助文档、MYIOTO 模板、CSS 代码片段、设置插件到 Vault
2. **一键部署**：单命令执行所有框架更新
3. **AI Agent 技能部署**：将技能部署到指定平台（TRAE、Claude Code、OpenCode、OpenAI Codex、Mimo Code、Hermes）
4. **个人同步模板**：从用户个人 Airtable 拉取自定义同步模板
5. **插件安装**：从 GitHub/Gitee 直接安装 IOTO 生态配套插件
6. **自更新**：在设置面板检查并安装插件新版本

---

## 技术栈

| 类别       | 技术                        | 版本 / 说明                   |
| ---------- | --------------------------- | ----------------------------- |
| 语言       | TypeScript                  | 4.7.4                         |
| 构建工具   | esbuild                     | 0.17.3                        |
| 目标运行时 | ES2018 (CommonJS)           |
| 平台 API   | Obsidian Plugin API         | latest，minAppVersion: 0.15.0 |
| 类型检查   | ESLint + @typescript-eslint | 5.29.0                        |
| 额外依赖   | @popperjs/core              | ^2.11.8                       |
| 国际化     | moment.locale() + 字典文件  | 英/简中/繁中                  |

### 构建脚本（package.json）

```bash
npm run dev      # 开发模式：esbuild watch 模式，输出 main.js 含内联 sourcemap
npm run build    # 生产构建：tsc 类型检查 + esbuild 压缩打包
npm run version  # 版本号自增并写入 manifest.json / versions.json
```

---

## 目录结构

```
ioto-update/
├── src/
│   ├── main.ts                      # 插件入口，IOTOUpdate 类
│   ├── types/
│   │   └── index.ts                 # 全局类型定义（设置、Airtable、NocoDB 等）
│   ├── models/
│   │   ├── default-settings.ts      # 默认设置常量 DEFAULT_SETTINGS
│   │   └── settings.ts              # SettingsManager：设置的加载/保存/更新
│   ├── services/
│   │   ├── service-container.ts     # 服务容器（懒加载单例）
│   │   ├── api-service.ts           # Airtable API：校验 API Key、拉取更新 ID
│   │   ├── command-service.ts       # 所有 Obsidian 命令的注册与执行
│   │   ├── github-service.ts        # GitHub Release 插件安装/版本检查
│   │   ├── gitee-service.ts         # Gitee Release 插件安装/版本检查
│   │   ├── plugin-service.ts        # 插件重载与启用的通用方法
│   │   ├── templater-service.ts     # 与 Templater 插件的交互
│   │   ├── ioto-settings-service.ts # IOTO 框架路径等设置的读取
│   │   └── db-syncer/
│   │       ├── nocodb.ts            # NocoDB API 封装（鉴权、URL 构造）
│   │       ├── nocodb-sync.ts       # 从 NocoDB 拉取记录并准备写入 Obsidian
│   │       └── ob-syncer.ts         # Obsidian Vault 文件的创建/更新
│   ├── suggesters/
│   │   ├── ai-platform-suggester.ts # AI 平台选择下拉
│   │   └── date-filter-suggester.ts # 日期过滤选项下拉
│   ├── ui/
│   │   ├── settings-tab.ts          # 设置面板入口 Tab
│   │   ├── tabbed-settings.ts       # 标签页切换组件
│   │   └── pickers/                 # 文件/文件夹建议选择器
│   ├── lang/
│   │   ├── helpers.ts               # t() 国际化函数
│   │   └── locale/
│   │       ├── en.ts
│   │       ├── zh-cn.ts
│   │       └── zh-tw.ts
│   └── utils/
│       ├── index.ts                 # 工具函数（校验、版本比较、URL 解析）
│       ├── error.ts
│       └── log.ts
├── manifest.json                    # Obsidian 插件清单（id、版本、权限）
├── esbuild.config.mjs               # esbuild 配置
├── tsconfig.json                    # TypeScript 配置
├── scripts/
│   └── deploy-release.mjs           # 一键发版脚本（npm run build:deploy）
└── styles.css                       # 插件自定义样式
```

---

## 核心架构与设计模式

### 1. 插件生命周期入口 [main.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/main.ts)

`IOTOUpdate` 类继承 `Plugin`，`onload()` 流程：

1. 实例化 `ServiceContainer`（服务容器）
2. 通过容器获取 `SettingsManager` 并加载设置
3. 从容器获取 `ApiService`、`TemplaterService`、`CommandService`
4. 调用 `commandService.registerCommands()` 注册所有 Obsidian 命令
5. 调用 `addSettingTab()` 挂载设置面板

**关键原则**：所有服务通过 `ServiceContainer` 获取，不直接 `new`，便于统一管理依赖。

### 2. 服务容器模式 [service-container.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/services/service-container.ts)

使用 **懒加载 + 只读 getter** 实现单例服务：

```
settingsManager → SettingsManager
apiService      → ApiService
templaterService→ TemplaterService
commandService  → CommandService
```

每个 getter 在首次访问时创建实例，之后返回缓存。

### 3. 设置管理 [settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/models/settings.ts) + [default-settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/models/default-settings.ts)

- `DEFAULT_SETTINGS` 提供初始值（含默认 Airtable/NocoDB 表 ID、默认下载源 gitee）
- `SettingsManager.load()` 会合并三层来源：`DEFAULT_SETTINGS` → IOTO 框架路径设置 → `plugin.loadData()`
- 保存通过 `SettingsManager.save()` → `plugin.saveData()`，Obsidian 内部写入 `data.json`

### 4. 命令注册中心 [command-service.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/services/command-service.ts)

#### 鉴权前置条件

`registerCommands()` 在以下条件全部满足时才注册功能命令，否则命令列表为空：

- `userChecked === true`（邮箱在 Airtable 许可库中存在）
- `updateAPIKeyIsValid === true`
- `Utils.isValidApiKey(updateAPIKey)`（长度 ≥82，含 `pat` 和 `.`）
- `Utils.isValidEmail(userEmail)`（RFC 5322 正则校验）

#### 已注册的核心命令

| 命令 ID                                 | 名称                                | 说明                                                  |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `get-core-files`                        | Update Core Files                   | 同步 IOTO 框架核心文件                                |
| `get-help-doc`                          | Update Help Docs                    | 同步帮助文档（含日期过滤）                            |
| `get-myioto`                            | Update MYIOTO Templates             | 同步 MYIOTO 模板（初始安装时会处理 SubFolder 命名）   |
| `get-css`                               | Update CSS Snippets                 | 同步 CSS 到 `.obsidian/snippets`，完成后重载 Obsidian |
| `get-setting-plugin`                    | Update IOTO Framwork Setting Plugin | 安装/更新 ioto-settings 插件，完成后重载              |
| `get-user-sync-scripts`                 | Get Your Personal Sync Templates    | 使用用户个人 Airtable Token 拉取自定义模板            |
| `run-all-updates`                       | Deploy IOTO With One Click          | 并行执行所有标记 `isPartOfAllUpdates` 的更新          |
| `get-skills`                            | Update Skills                       | 弹出 AI 平台选择器后部署技能文件到对应目录            |
| `update-user-permissions`               | Update User Permissions             | 重新从 Airtable 拉取 updateIDs 并保存                 |
| `install-itg-from-github`               | Install IOTO Template Generator     | 安装模板生成器插件                                    |
| `install-ioto-dashboard-from-github`    | Install IOTO Dashboard              | 安装仪表板插件                                        |
| `install-ioto-tasks-center-from-github` | Install IOTO Tasks Center           | 安装任务中心插件                                      |
| `install-ssg-from-github`               | Install Sync Scripts Generator      | 仅对特定 viewID 用户可见                              |

#### NocoDB 同步执行流程

```
createNocoDBCommand(id, name, tableConfig, reloadOB, iotoUpdate, filterRecordsByDate, apiKey, forceEnSyncFields)
  └─ withDisabledTemplaterTrigger()  ← 执行期间临时关闭 Templater 的 trigger_on_file_creation，避免同步触发模板渲染
       └─ executeNocoDBCommand()
            ├─ Utils.buildFieldNames() 根据语言选择 Title/TitleEN/TitleTW 等字段映射
            ├─ new NocoDB(nocoDBSettings)
            ├─ new NocoDBSync(nocoDB, app)
            ├─ new ObsidianSyncer(app, nocoDBSync)
            └─ obSyncer.onlyFetchFromNocoDB(...)
                 └─ nocoDBSync.createOrUpdateNotesInOBFromSourceTable()
                      ├─ fetchRecordsFromSource()  ← 支持日期过滤弹窗 + 分页(offset)拉取
                      ├─ 转换字段名（Title/MD/SubFolder 多语言统一）
                      ├─ 每批 10 条，create / modify / adapter.write（.obsidian 目录用 adapter）
                      └─ 每次 modify 后 sleep 100ms 等待元数据更新
```

**注意**：目标路径以 `.` 开头（如 `.obsidian/...`）时使用 `vault.adapter.write()`，否则使用标准 `vault.modify()`。

### 5. API 服务 [api-service.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/services/api-service.ts)

两个关键方法：

- `checkApiKey()`：通过 Webhook + Airtable 查询确认 API Key 有效性，流程为 POST Webhook → wait 1500ms → GET 匹配结果
- `getUpdateIDs()`：按用户邮箱从 Airtable 许可库查询对应的各表 baseID/tableID/viewID，失败时回退到 `DEFAULT_UPDATE_IDS`

### 6. GitHub / Gitee 插件安装服务

统一流程 [github-service.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/services/github-service.ts)：

1. `parseRepoUrl()` 解析 owner/repo
2. `getLatestRelease()` 获取最新 Release
3. 下载 `manifest.json` / `main.js` / `styles.css`（如有）
4. 比较已安装版本，相同则跳过
5. 写入 `${configDir}/plugins/${pluginId}/`
6. 调用 `PluginService.reloadAndEnablePlugin()` 热更新已安装插件

Gitee 版本见 [gitee-service.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/services/gitee-service.ts)，逻辑几乎一致，仅 API 端点不同。

### 7. 国际化 [lang/helpers.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/lang/helpers.ts)

- `t(key)` 函数根据 `moment.locale()` 从 `localeMap` 选字典，找不到回退英文
- 新增字符串时：先在 `en.ts` 添加键，再同步到 `zh-cn.ts` / `zh-tw.ts`
- 部分逻辑（如字段名映射）还会参考 `settings.iotoRunningLanguage`，可选 `ob`（跟随 Obsidian）、`zh-cn`、`zh-tw`、`en`

---

## 核心类型定义速查 [types/index.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/types/index.ts)

| 接口                 | 关键字段                                                                                                                                                 | 用途                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `IOTOUpdateSettings` | `updateAPIKey`, `userEmail`, `pluginDownloadSource`, `iotoFrameworkPath`, `updateIDs.{...}`, `userAPIKey`, `userSyncSettingUrl`, `userSyncScriptsFolder` | 插件完整设置结构                      |
| `AirtableIds`        | `baseId`, `tableId`, `viewId`                                                                                                                            | 从 Airtable URL 解析的三元组          |
| `NocoDBTable`        | `viewID`, `baseID?`, `tableID?`, `targetFolderPath`, `intialSetup?`                                                                                      | 单个同步表的配置                      |
| `NocoDBSettings`     | `apiKey`, `tables[]`, `iotoUpdate?`, `syncSettings.recordFieldsNames{}`                                                                                  | NocoDB 同步的完整配置                 |
| `RecordFields`       | `Title?`, `TitleEN?`, `TitleTW?`, `MD?`, `MDEN?`, `MDTW?`, `SubFolder?`, `Extension?`, `UpdatedIn?`                                                      | Airtable/NocoDB 单条记录字段          |
| `DateFilterOption`   | `id`, `name`, `value`                                                                                                                                    | 日期过滤下拉选项（value=99 表示全部） |

---

## 开发工作流程与常见任务

### 任务 A：新增一条 NocoDB 同步命令

1. 在 `IOTOUpdateSettings.updateIDs` 添加对应 `{baseID, tableID, viewID}` 字段，并在 `DEFAULT_SETTINGS` 及 `ApiService.getUpdateIDs()` 返回的 JSON 中同步加入
2. 在 `CommandService.getCommandConfigs()` 数组追加一项 `CommandConfig`，设置 `id`、`name`、`tableConfig()`，必要时 `reloadOB: true`、`filterRecordsByDate: true`、`isPartOfAllUpdates: true`
3. 在三份语言文件中为 `name` 对应 key 添加翻译
4. `npm run build` 验证类型，`npm run dev` 启动 Obsidian 社区插件热加载环境测试

### 任务 B：新增一个配套插件安装命令

1. 在 `CommandService.registerCommands()` 末尾的已鉴权分支中调用 `this.addCommand()`
2. 根据 `settings.pluginDownloadSource`（`github` / `gitee`）选择调用 `GithubService.installPluginFrom()` 或 `GiteeService.installPluginFrom()`
3. 命令名后缀使用 `t("PluginIndicator")` 表示「插件」标签
4. 如果需要权限控制，参考 `install-ssg-from-github` 的 viewID 白名单判断

### 任务 C：新增语言翻译 key

1. 在 `src/lang/locale/en.ts` 中添加 key（作为基准，回退默认值）
2. 同步添加到 `zh-cn.ts` 和 `zh-tw.ts`
3. 确保 key **与 en.ts 的对象键完全一致**，`t()` 通过 keyof typeof en 做类型检查，缺 key 会编译报错

### 任务 D：修改设置面板

1. 设置面板按 Tab 组织：`Basic`、`IOTO_UPDATES`、`IOTO_TOTURIALS`
2. 在 [settings-tab.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/ui/settings-tab.ts) 对应 `renderXxxSettings()` 方法里追加 `new Setting(containerEl)`
3. 文本框如需路径建议，使用 `FolderSuggest`（文件夹）或 `FileSuggest`（文件），参照同文件已有示例
4. 修改设置值后务必调用 `await this.plugin.saveSettings()`，并考虑是否需要重新注册命令（`this.plugin.app.commands` 不支持热更新，需要用户重载）

### 任务 E：调试 NocoDB 同步失败

1. 检查 `nocoDBSettings.apiKey` 是否通过 `Utils.isValidApiKey`（注意返回 401 时会有 Notice 提示）
2. 字段名映射问题：确认 `iotoRunningLanguage` 与表中实际字段名（Title vs TitleEN vs TitleTW）一致
3. `.obsidian/` 下的写入必须使用 `vault.adapter.write`，否则无权限
4. 分批写入每批 10 条 + 100ms 延迟是为了避免 Obsidian 元数据竞争，**不要轻易去除**

---

## 代码规范与约定

### TypeScript 规则（tsconfig.json）

- `noImplicitAny: true`、`strictNullChecks: true`、`moduleResolution: node`
- 类型导入遵循文件头部显式 import，禁止隐式 any
- 访问 Obsidian 未公开 API（如 `app.commands.executeCommandById`、`app.plugins.manifests`、`app.dom.appContainerEl`）使用 `// @ts-ignore` 或在 [types/index.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-update/src/types/index.ts) 的 `declare module "obsidian"` 中扩展类型，优先扩展类型

### 命名约定

- 类名：PascalCase（`CommandService`、`SettingsManager`）
- 方法/变量：camelCase
- 常量/配置对象：UPPER_SNAKE_CASE（`DEFAULT_SETTINGS`、`AIRTABLE_CONFIG`）
- 语言 key：直接使用英文显示文本作为键（如 `"Update Core Files"`），避免二次映射

### 文件写入路径策略

```
目标路径以 . 开头 → vault.adapter.write(path, content)
目标路径为普通 Vault 路径且文件存在 → vault.modify(file, content) + sleep 100ms
目标路径为普通 Vault 路径且文件不存在 → vault.create(path, content)
目录不存在 → vault.createFolder(normalizePath(folderPath))
```

### 鉴权与许可

- **永远不要** 在代码中硬编码真实 Airtable Token、Webhook URL，这些由 `constants.ts` 中的 `AIRTABLE_CONFIG` 提供（该文件未公开）
- 所有功能命令在 `registerCommands()` 前统一做 4 项校验，不要绕开
- 用户个人同步模板使用用户自己的 `userAPIKey`，不要混用 updateAPIKey

### 错误处理

- 用户可感知的错误一律用 `new Notice(message)` 显示，不要抛裸错给用户
- 关键逻辑的失败在 `console.error` 打日志，便于开发者调试
- `createRunAllUpdatesCommand` 使用 `Promise.allSettled` 而非 `Promise.all`，避免单个子任务失败中断全部

---

## 构建与发布

1. **版本号升级**：`npm run version` 会同步更新 `package.json`、`manifest.json`、`versions.json`
2. **构建**：`npm run build` 生成 `main.js`（压缩，无 sourcemap）+ `styles.css` 保持原样
3. **发布**：`npm run build:deploy` 一键完成构建、打包（main.js / manifest.json / styles.css + ioto-update.zip）、打 tag，并发布到 GitHub 与 Gitee；GitHub 复用已登录的 `gh`，Gitee 需环境变量 `GITEE_TOKEN` 或本地 `.gitee-token` 文件。支持 `--dry-run` / `--github-only` / `--gitee-only` / `--force` / `--notes`。
4. **自更新测试**：在 Obsidian 设置面板点击「Check for Updates」，会从当前 `pluginDownloadSource` 的 Release 下载比较 manifest.json 版本号，落后则自动更新并热加载

---

## 关键扩展点与注意事项

1. **新增 AI 平台**：在 `AIPlatformSuggester` 的平台列表中追加一项 `{name, value: '目标根目录'}`，例如 `{ name: "TRAE", value: ".trae" }`，技能文件会同步写入 `{vault}/.trae/...`
2. **下载源切换**：所有需要外部下载的地方都要同时支持 GitHub 和 Gitee，判断入口是 `settings.pluginDownloadSource ?? "github"`
3. **Templater 干扰**：同步过程中会临时禁用 `trigger_on_file_creation`，完成后恢复；**新增任何写文件命令** 都应包装在 `withDisabledTemplaterTrigger` 中，避免批量同步触发大量模板渲染
4. **重载 Obsidian**：涉及 `.obsidian/plugins` 或 `.obsidian/snippets` 写入的命令必须在完成后 `executeCommandById("app:reload")`（延迟 1000ms），并优先尝试 `PluginService.reloadAndEnablePlugin` 热加载
5. **字段名多语言映射**：`Utils.buildFieldNames(forceDefaultFetchFields, iotoRunningLanguage)` 是唯一入口，不要在各处硬编码 TitleEN/MDTW 等分支

---

## 安全红线

- 不要在日志 / Notice / 错误信息中打印用户 API Key（`updateAPIKey`、`userAPIKey`）或邮箱明文
- 不要修改版本号递增脚本（`version-bump.mjs`）绕过版本历史
- 从 GitHub/Gitee 下载插件时，**必须先下载 manifest.json 校验 pluginId 和 version**，再决定是否覆盖，避免 URL 投毒覆盖错误插件
- Airtable / NocoDB 请求使用 Authorization Bearer 头，不要把 token 写在 URL query 中

---

以上即为 IOTO Update 插件的完整开发规范。进行任何修改前，请先阅读对应模块源码，遵循现有服务容器 + 命令中心 + 同步三层架构的模式扩展。
