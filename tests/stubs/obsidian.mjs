/**
 * `obsidian` 依赖只提供 `.d.ts`，没有运行时代码。
 * 这里给出单测所需的**最小可导入实现**，只替 Obsidian 边界，不模拟 Obsidian 行为：
 * 桩里的布局 / 渲染 / 事件一律是空壳，测试断言的都是插件自己的逻辑。
 *
 * 约定（与 `ioto-tasks-center` / `text-popup` 一致）：
 * - `notices` 按顺序记录 `new Notice(...)` 的文案，命令层没有返回值，提示是唯一可观测输出；
 * - `requestUrl` 转发到测试设置的 handler，避免任何真实网络请求；
 * - 必须放在插件目录内，`moment` 才能从本项目的 `node_modules` 命中。
 */

// Obsidian 运行环境始终存在 window 全局；补一个最小实现，
// 让源码里按 lint 规则写的 window.setTimeout 等在 Node 测试里也能运行。
if (typeof globalThis.window === 'undefined') {
	globalThis.window = globalThis;
}

// 重导出**真实** moment：`lang/helpers.ts` 与 `Utils.buildFieldNames` 都读 moment.locale()，
// 用假 moment 会掩盖语言变体的真实行为。测试里用 moment.locale(...) 切换语言。
import moment from 'moment';

export { moment };

/** 源码里的 `declare function requestUrl(...)` 指向运行时全局。 */
export function requestUrl(options) {
	const handler = globalThis.__requestUrlHandler;
	if (typeof handler !== 'function') {
		throw new Error('requestUrl 桩未设置：请先调用 setRequestUrlHandler()');
	}
	return handler(options);
}

/** 设置 requestUrl 的行为（同名导出给 import 版调用方，global 版给 declare 版调用方）。 */
export function setRequestUrlHandler(handler) {
	globalThis.__requestUrlHandler = handler;
	globalThis.requestUrl = requestUrl;
}

export function resetRequestUrlHandler() {
	globalThis.__requestUrlHandler = undefined;
}

// 让 `declare function requestUrl` 形式的代码（api-service / nocodb-sync）可用。
globalThis.requestUrl = requestUrl;

export class App {}

export class Component {
	addChild(child) {
		return child;
	}

	removeChild() {}
}

export class Plugin {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest;
	}
}

export class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement('div');
	}
}

export class TAbstractFile {
	constructor(path) {
		this.path = path;
		this.name = path.split('/').pop() ?? '';
	}
}

export class TFile extends TAbstractFile {
	constructor(path) {
		super(path);
		this.extension = this.name.includes('.')
			? (this.name.split('.').pop() ?? '')
			: '';
		this.basename = this.name.replace(/\.[^.]+$/, '');
	}
}

export class TFolder extends TAbstractFile {
	constructor(path) {
		super(path);
		this.children = [];
	}
}

/** `src/utils/index.ts` 的 `get_tfiles_from_folder` 依赖这个静态方法。 */
export class Vault {
	static recurseChildren(folder, callback) {
		for (const child of folder.children ?? []) {
			callback(child);
			if (child instanceof TFolder) {
				Vault.recurseChildren(child, callback);
			}
		}
	}
}

/**
 * 命令层是 `void` 函数，提示文案是它唯一的可观测输出。
 * `messageEl` 供 `utils/log.ts` 直接写 innerHTML（真机里由 Notice 提供）。
 */
export const notices = [];
export const hiddenNotices = [];

export class Notice {
	constructor(message, timeout) {
		this.message = message;
		this.timeout = timeout;
		this.messageEl = { innerHTML: '' };
		notices.push(message);
	}

	hide() {
		hiddenNotices.push(this);
	}
}

/** Obsidian 的路径规范化：反斜杠转正斜杠、合并重复斜杠、去掉末尾斜杠。 */
export function normalizePath(pathStr) {
	return String(pathStr)
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/\/$/, '');
}

export class Menu {}

export class Scope {
	register() {
		return {};
	}
}

export class Modal {
	constructor(app) {
		this.app = app;
	}
	open() {}
	close() {}
}

/** 补全类弹窗共同基类：测试只会 import 子类，不触发真实弹窗。 */
export class SuggestModal extends Modal {
	setPlaceholder() {}
	getSuggestions() {
		return [];
	}
	renderSuggestion() {}
	onChooseItem() {}
}

export class FuzzySuggestModal extends SuggestModal {}

export class Setting {
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	setHeading() {
		return this;
	}
	setClass() {
		return this;
	}
	addButton() {
		return this;
	}
	addText() {
		return this;
	}
	addTextArea() {
		return this;
	}
	addToggle() {
		return this;
	}
	addDropdown() {
		return this;
	}
	addSearch() {
		return this;
	}
}

export class ButtonComponent {}

export function setIcon() {}

export function debounce(fn) {
	return fn;
}

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isPhone: false,
	isTablet: false,
};
