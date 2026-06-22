# 计划：更新 IOTO Update 插件的 README.md

## 概述
根据当前代码库的实际功能，重写 `README.md`，使其准确反映插件提供的所有命令、设置和功能。

## 当前状态分析
现有 README.md 内容极其简陋，仅有两行功能描述：
```
- Update the IOTO Framework
- Update your personal sync templates
```
这远不能反映插件的实际能力。通过代码探索，插件实际提供以下功能模块：

### 1. 内容更新命令（通过 Airtable/NocoDB 同步）
来源：[command-service.ts](src/services/command-service.ts) `getCommandConfigs()` + 自定义命令
- **Deploy IOTO With One Click** - 一键部署（聚合下面标记为 `isPartOfAllUpdates` 的命令）
- **Update Core Files** - 更新 IOTO 核心文件
- **Update Help Docs** - 更新帮助文档（支持按日期筛选）
- **Update MYIOTO Templates** - 更新 MYIOTO 模板
- **Update CSS Snippets** - 更新 CSS 片段（部署到 `.obsidian/snippets`）
- **Update IOTO Framework Setting Plugin** - 更新 IOTO Settings 插件
- **Update Skills** - 更新 AI Agent 技能（支持选择平台：TRAE/Claude Code/OpenCode/OpenAI Codex/Mimo Code/Hermes）
- **Get Your Personal Sync Templates** - 获取个人同步模板
- **Update User Permissions** - 更新用户权限（刷新 updateIDs）

### 2. 插件安装命令（通过 GitHub/Gitee）
来源：[command-service.ts](src/services/command-service.ts) L229-324
- Install IOTO Template Generator
- Install Sync Scripts Generator（仅特定 viewID 用户可见）
- Install IOTO Dashboard
- Install IOTO Tasks Center

### 3. 设置项
来源：[settings-tab.ts](src/ui/settings-tab.ts)
- 插件自身版本检查与更新（支持 GitHub/Gitee 源）
- Update API Key（带验证）
- Email（带验证，用于获取权限）
- Plugin Download Source（GitHub / Gitee）
- IOTO Running Language（跟随系统 / 简中 / 繁中 / 英文）
- IOTO Framework Path
- User Sync 配置（Airtable Token、Sync Setting URL、Sync Templates Folder）

### 4. 其他特性
- 多语言支持（en / zh-cn / zh-tw）
- 插件自身可从 GitHub 或 Gitee 检查并更新
- 设置面板含三个 Tab：Basic、IOTO Updates、IOTO Tutorials

### 5. 插件元信息
来源：[manifest.json](manifest.json)
- 名称：IOTO Update
- 作者：Johnny
- 仓库：https://github.com/shawndotty/ioto-update
- 赞助：https://space.bilibili.com/432408734
- minAppVersion: 0.15.0

## 拟定变更

### 文件：`README.md`
完全重写，结构如下：

1. **标题 + 简介** - 一句话说明插件用途
2. **Features（功能列表）** - 按类别分组列出所有命令
   - IOTO Framework Updates（核心文件、帮助文档、模板、CSS、设置插件）
   - One-Click Deploy
   - AI Agent Skills（列出支持的 6 个平台）
   - Personal Sync Templates
   - Plugin Installation（列出 4 个可安装插件）
   - Self-Update（插件自身检查与更新）
3. **Settings（设置说明）** - 简述关键设置项
4. **Plugin Download Source** - 说明 GitHub/Gitee 双源
5. **Languages** - 说明支持的语言
6. **Requirements** - minAppVersion 与 IOTO Framework
7. **Author & Links** - 作者、仓库、赞助链接

## 假设与决策
- README 使用英文编写（与现有 README 一致，且插件面向国际用户）
- 不添加安装步骤（Obsidian 社区插件通常不在 README 详述手动安装）
- 保持简洁，不冗余；功能列表用分类+项目符号
- AI Agent Skills 部分列出所有 6 个支持平台及其部署目录

## 验证步骤
1. 阅读更新后的 README，确认所有命令名称与代码中的一致
2. 确认 AI Agent 平台列表与 [ai-platform-suggester.ts](src/suggesters/ai-platform-suggester.ts) 一致
3. 确认插件安装列表与 command-service.ts 中的注册一致
