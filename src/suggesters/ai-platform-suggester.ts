import { FuzzySuggestModal, FuzzyMatch } from "obsidian";
import { t } from "../lang/helpers";

export interface AIPlatformOption {
	id: string;
	name: string;
	value: string;
}

export class AIPlatformSuggester extends FuzzySuggestModal<AIPlatformOption> {
	private options: AIPlatformOption[] = [
		{ id: "trae", name: t("TRAE"), value: ".trae" },
		{ id: "workbuddy", name: t("Workbuddy"), value: ".workbuddy" },
		{ id: "codebuddy", name: t("Codebuddy"), value: ".codebuddy" },
		{ id: "claude", name: t("Claude Code"), value: ".claude" },
		{ id: "opencode", name: t("OpenCode"), value: ".opencode" },
		{ id: "codex", name: t("OpenAI Codex"), value: ".agents" },
		{ id: "mimo", name: t("Mimo Code"), value: ".mimocode" },
		{ id: "hermes", name: t("Hermes"), value: ".hermes" },
	];

	getItems(): AIPlatformOption[] {
		return this.options;
	}

	getItemText(item: AIPlatformOption): string {
		return item.name;
	}

	onChooseItem(
		item: AIPlatformOption,
		_evt: MouseEvent | KeyboardEvent,
	): AIPlatformOption {
		return item;
	}

	renderSuggestion(
		item: FuzzyMatch<AIPlatformOption>,
		el: HTMLElement,
	): void {
		el.createEl("div", { text: item.item.name, cls: "suggester-title" });
	}
}
