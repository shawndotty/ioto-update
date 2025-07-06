import { FuzzySuggestModal, FuzzyMatch } from "obsidian";
import { t } from "../lang/helpers";
import { DateFilterOption } from "../types";

export class DateFilterSuggester extends FuzzySuggestModal<DateFilterOption> {
	private options: DateFilterOption[] = [
		{ id: "day", name: t("Help documents updated today"), value: 1 },
		{
			id: "week",
			name: t("Help documents updated in the past week"),
			value: 7,
		},
		{
			id: "twoWeeks",
			name: t("Help documents updated in the past two weeks"),
			value: 14,
		},
		{
			id: "month",
			name: t("Help documents updated in the past month"),
			value: 30,
		},
		{ id: "all", name: t("All help documents"), value: 99 },
	];

	getItems(): DateFilterOption[] {
		return this.options;
	}

	getItemText(item: DateFilterOption): string {
		return item.name;
	}

	onChooseItem(
		item: DateFilterOption,
		evt: MouseEvent | KeyboardEvent
	): DateFilterOption {
		return item;
	}

	renderSuggestion(
		item: FuzzyMatch<DateFilterOption>,
		el: HTMLElement
	): void {
		el.createEl("div", { text: item.item.name, cls: "suggester-title" });
	}
}
