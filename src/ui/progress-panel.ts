/**
 * 一键更新完整 IOTO 的悬浮进度面板。
 *
 * 为什么不是 `Modal`：Modal 会占焦点、会挡住用户继续操作，而全量更新可能跑几十秒。
 * 这里直接挂 `document.body`，层级用 `--layer-notice`（真机实测 60 > `--layer-modal` 50），
 * 保证它压在设置弹窗之上。
 *
 * 面板只消费编排器抛出的 `FullUpdateEvent`，自己不做任何判定。
 */

import { setIcon } from "obsidian";
import type en from "../lang/locale/en";
import { t } from "../lang/helpers";
import type {
	FullUpdateEvent,
	FullUpdateStageName,
	FullUpdateSummary,
	StageResult,
} from "../services/full-update-service";
import { IOTO_PLUGINS } from "../services/plugin-registry";

const RELOAD_DELAY_SECONDS = 3;

const STAGE_LABEL_KEYS: Record<FullUpdateStageName, keyof typeof en> = {
	framework: "Updating Framework",
	"setting-plugin": "Updating Framework Setting Plugin",
	"aux-plugins": "Updating Auxiliary Plugins",
	self: "Updating IOTO Update",
};

function pluginName(key: string): string {
	const entry = IOTO_PLUGINS.find((item) => item.key === key);
	return entry ? t(entry.nameKey) : key;
}

/** 安装结果 → 面板上的状态文案。 */
function statusText(status: string): string {
	switch (status) {
		case "updated":
			return t("Plugin updated");
		case "up-to-date":
			return t("Up to date");
		case "dev-version":
			return t("Dev version (skipped)");
		case "skipped":
			return t("Skipped");
		case "not-found":
		case "failed":
			return t("Failed");
		default:
			return status;
	}
}

export class FullUpdateProgressPanel {
	private containerEl: HTMLElement;
	private barFillEl: HTMLElement;
	private counterEl: HTMLElement;
	private currentEl: HTMLElement;
	private listEl: HTMLElement;
	private footerEl: HTMLElement;
	private auxRowEls: HTMLElement[] = [];
	private total = 0;
	/** 最近一次已知的累计完成单位数：`stage-start` 续上它，而不是从 0 重来 */
	private done = 0;
	/** 进度条当前值（单位同 done，允许小数：框架阶段的表内进度） */
	private barValue = 0;
	private reloadTimer: number | null = null;
	private countdownTimer: number | null = null;
	private destroyed = false;

	constructor() {
		this.containerEl = document.body.createDiv({
			cls: "ioto-full-update-panel",
		});

		const headerEl = this.containerEl.createDiv({
			cls: "ioto-fu-header",
		});
		headerEl.createSpan({
			cls: "ioto-fu-title",
			text: t("Full Update Progress"),
		});
		const closeEl = headerEl.createEl("button", {
			cls: "clickable-icon ioto-fu-close",
			attr: { type: "button", "aria-label": "Close", title: "Close" },
		});
		setIcon(closeEl, "x");
		closeEl.addEventListener("click", () => this.destroy());

		const barEl = this.containerEl.createDiv({ cls: "ioto-fu-bar" });
		this.barFillEl = barEl.createDiv({ cls: "ioto-fu-bar-fill" });

		const metaEl = this.containerEl.createDiv({ cls: "ioto-fu-meta" });
		this.counterEl = metaEl.createSpan({
			cls: "ioto-fu-counter",
			text: "0/0",
		});
		this.currentEl = metaEl.createSpan({
			cls: "ioto-fu-current",
			text: "",
		});

		this.listEl = this.containerEl.createDiv({ cls: "ioto-fu-list" });
		this.footerEl = this.containerEl.createDiv({ cls: "ioto-fu-footer" });
	}

	handle(event: FullUpdateEvent) {
		if (this.destroyed) return;

		switch (event.type) {
			case "stage-start":
				this.total = event.total;
				this.setCurrent(t(STAGE_LABEL_KEYS[event.stage]));
				// 计数器只增不减：新阶段续上已完成的单位，否则 n 会被打回 0
				this.updateCounter(this.done);
				break;

			case "framework-progress":
				// 框架阶段是一张「单位」里的表内进度：只喂进度条，不改 n/total 文字
				if (event.total > 0) {
					this.setCurrent(
						`${t("Updating Framework")} ${event.done}/${event.total}`,
					);
					this.setBarOnly(this.done + event.done / event.total);
				}
				break;

			case "plugin-progress":
				this.setCurrent(pluginName(event.key));
				// 事件自带的 done 是「本插件开始前」的累计值，直接上屏
				this.updateCounter(event.done);
				this.auxRowEls[event.index] = this.appendRow(
					pluginName(event.key),
					t("Updating..."),
				);
				break;

			case "stage-end":
				this.renderStage(event.stage, event.result, event.done);
				break;

			case "finished":
				this.renderFinished(event.summary);
				break;
		}
	}

	/**
	 * 请求重载：先把结论留在面板上，再倒计时 3 秒自动重载，
	 * 用户也可以点「立即重载」提前触发。
	 */
	requestReload(onReload: () => void) {
		if (this.destroyed) {
			onReload();
			return;
		}

		this.footerEl.empty();
		const countdownEl = this.footerEl.createSpan({
			cls: "ioto-fu-countdown",
			text: `${t("Reloading in")} ${RELOAD_DELAY_SECONDS}...`,
		});
		const reloadBtn = this.footerEl.createEl("button", {
			cls: "mod-cta",
			text: t("Reload Now"),
		});
		reloadBtn.addEventListener("click", () => {
			this.clearTimers();
			onReload();
		});

		let remaining = RELOAD_DELAY_SECONDS;
		this.reloadTimer = window.setInterval(() => {
			remaining -= 1;
			countdownEl.setText(`${t("Reloading in")} ${remaining}...`);
			if (remaining <= 0) {
				this.clearTimers();
				onReload();
			}
		}, 1000);
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.clearTimers();
		this.containerEl.remove();
	}

	private clearTimers() {
		if (this.reloadTimer !== null) {
			window.clearInterval(this.reloadTimer);
			this.reloadTimer = null;
		}
	}

	private setCurrent(text: string) {
		this.currentEl.setText(text);
	}

	private renderStage(
		stage: FullUpdateStageName,
		result: StageResult,
		done: number,
	) {
		if (stage === "aux-plugins") {
			result.items.forEach((item, index) => {
				const rowEl = this.auxRowEls[index];
				const text = `${item.label} — ${this.itemText(
					item.status,
					item.detail,
				)}`;
				if (rowEl) {
					rowEl.setText(text);
				} else {
					this.auxRowEls[index] = this.appendRow(
						item.label,
						this.itemText(item.status, item.detail),
					);
				}
			});
		} else {
			result.items.forEach((item) => {
				this.appendRow(
					item.label,
					this.itemText(item.status, item.detail),
				);
			});
		}

		this.updateCounter(done);
	}

	private renderFinished(summary: FullUpdateSummary) {
		this.updateCounter(summary.done);
		this.setCurrent(
			`${t("Update finished")} — ${summary.done}/${summary.total}`,
		);

		if (summary.failed === 0 && summary.migratedIds.length === 0) return;

		const detailEl = this.listEl.createDiv({ cls: "ioto-fu-detail" });
		if (summary.failed > 0) {
			detailEl.createDiv({
				text: `${t("Failed")}: ${summary.failed}`,
			});
		}
		for (const migration of summary.migratedIds) {
			detailEl.createDiv({
				text: `${t("Migrated plugin id")}: ${migration}`,
			});
		}
	}

	private itemText(status: string, detail?: string): string {
		const base = statusText(status);
		// 跳过原因（未安装 / 白名单）属于内部细节，面板只给结论
		if (!detail || status === "skipped") return base;
		return `${base} (${detail})`;
	}

	private appendRow(label: string, text: string): HTMLElement {
		return this.listEl.createDiv({
			cls: "ioto-fu-row",
			text: `${label} — ${text}`,
		});
	}

	private updateCounter(done: number) {
		this.done = done;
		this.counterEl.setText(`${done}/${this.total}`);
		this.setBarOnly(done);
	}

	/** 只推进进度条；值取历史最大值，保证宽度不回退。 */
	private setBarOnly(value: number) {
		if (value <= this.barValue) return;
		this.barValue = value;
		const percent =
			this.total > 0 ? Math.round((value / this.total) * 100) : 0;
		this.barFillEl.style.width = `${percent}%`;
	}
}
