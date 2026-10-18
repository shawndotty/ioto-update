import { App, Modal } from "obsidian";
import { t } from "../../lang/helpers";

/** 写入 MyIOTO 时的子目录形式：`MyIOTO` 或 `MyIOTO-x-y-z`。 */
export type MyIotoSubFolderMode = "unversioned" | "versioned";

/**
 * 询问「更新 MYIOTO 模板」本次写入的子目录形式。
 * 返回 null 表示用户取消（Esc / 点击遮罩）。
 */
export function askMyIotoSubFolderMode(
	app: App,
): Promise<MyIotoSubFolderMode | null> {
	return new Promise((resolve) => {
		new MyIotoSubFolderModeModal(app, resolve).open();
	});
}

class MyIotoSubFolderModeModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private settle: (mode: MyIotoSubFolderMode | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(t("MYIOTO SubFolder Mode Title"));
		contentEl.createEl("p", {
			text: t("MYIOTO SubFolder Mode Description"),
		});

		const buttons = contentEl.createDiv({
			cls: "modal-button-container",
		});
		const flatBtn = buttons.createEl("button", {
			text: t("MYIOTO Flatten Version In Path"),
			cls: "mod-cta",
		});
		const versionedBtn = buttons.createEl("button", {
			text: t("MYIOTO Keep Version In Path"),
		});

		flatBtn.addEventListener("click", () => this.finish("unversioned"));
		versionedBtn.addEventListener("click", () => this.finish("versioned"));
		flatBtn.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		// 点按钮时 close() 会再次触发 onClose，靠 settled 防重复 resolve
		this.finish(null);
	}

	private finish(mode: MyIotoSubFolderMode | null): void {
		if (this.settled) return;
		this.settled = true;
		this.settle(mode);
		if (mode) this.close();
	}
}
