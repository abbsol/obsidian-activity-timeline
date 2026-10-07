import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import {
	buildHeatmap,
	countByKind,
	dayKey,
	filterEvents,
	groupByDay,
	listFolders,
	periodRange,
	shiftAnchor,
	startOfDay,
} from "./aggregate";
import type ActivityTimelinePlugin from "./main";
import type { Group, Period } from "./types";
import { formatDay, formatFullDay, formatMonth, Handlers, render, ViewModel } from "./ui";

export const VIEW_TYPE = "activity-timeline-view";

const HEAT_WEEKS = 10;
const DAYS_PER_PAGE = 30;

export class TimelineView extends ItemView {
	private period: Period = "week";
	private anchor = startOfDay(new Date());
	private group: Group = "all";
	private folder = "";
	private visibleDays = DAYS_PER_PAGE;
	private root!: HTMLElement;
	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: ActivityTimelinePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Activity timeline";
	}

	getIcon(): string {
		return "history";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("at-view");
		this.root = this.contentEl.createDiv({ cls: "at-root" });
		this.register(this.plugin.store.onChange(() => this.scheduleRefresh()));
		this.registerInterval(window.setInterval(() => this.refresh(), 5 * 60_000));
		this.refresh();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		return Promise.resolve();
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) return;
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 500);
	}

	refresh(): void {
		const main = this.root.querySelector(".at-main");
		const side = this.root.querySelector(".at-side");
		const scroll = [main?.scrollTop ?? 0, side?.scrollTop ?? 0];
		render(this.root, this.buildModel(), this.handlers, (el, name) => setIcon(el, name));
		const newMain = this.root.querySelector(".at-main");
		const newSide = this.root.querySelector(".at-side");
		if (newMain) newMain.scrollTop = scroll[0];
		if (newSide) newSide.scrollTop = scroll[1];
	}

	private buildModel(): ViewModel {
		const mondayFirst = this.plugin.settings.weekStartsOnMonday;
		const all = this.plugin.store.all();
		const range = periodRange(this.period, this.anchor, mondayFirst);
		const inRange = filterEvents(all, { from: range.from, to: range.to });
		const filtered = filterEvents(inRange, { group: this.group, folder: this.folder });
		const groups = groupByDay(filtered);
		const now = new Date();

		return {
			period: this.period,
			group: this.group,
			folder: this.folder,
			rangeLabel: this.rangeLabel(range.from, range.to),
			isCurrent: now.getTime() >= range.from && now.getTime() < range.to,
			days: groups.slice(0, this.visibleDays),
			hiddenDays: Math.max(0, groups.length - this.visibleDays),
			totalEvents: filtered.length,
			heat: buildHeatmap(filterEvents(all, { group: this.group, folder: this.folder }), now, HEAT_WEEKS, mondayFirst),
			heatWeeks: HEAT_WEEKS,
			counts: countByKind(filterEvents(inRange, { folder: this.folder })),
			folders: listFolders(inRange),
			todayKey: dayKey(now),
		};
	}

	private rangeLabel(from: number, to: number): string {
		const start = new Date(from);
		const end = new Date(to - 1);
		switch (this.period) {
			case "day":
				return formatFullDay(start);
			case "week":
				return `${formatDay(start)} – ${formatDay(end)}`;
			case "month":
				return formatMonth(start);
			case "year":
				return String(start.getFullYear());
		}
	}

	private update(fn: () => void): void {
		fn();
		this.visibleDays = DAYS_PER_PAGE;
		this.refresh();
	}

	private handlers: Handlers = {
		setPeriod: (p) =>
			this.update(() => {
				this.period = p;
				this.anchor = startOfDay(new Date());
			}),
		shift: (dir) => this.update(() => (this.anchor = shiftAnchor(this.period, this.anchor, dir))),
		goToday: () => this.update(() => (this.anchor = startOfDay(new Date()))),
		setGroup: (g) => this.update(() => (this.group = g)),
		setFolder: (f) => this.update(() => (this.folder = f)),
		pickDay: (d) =>
			this.update(() => {
				this.period = "day";
				this.anchor = startOfDay(d);
			}),
		showMore: () => {
			this.visibleDays += DAYS_PER_PAGE;
			this.refresh();
		},
		openEvent: (e, newPane) => {
			const file = this.app.vault.getAbstractFileByPath(e.path);
			if (!(file instanceof TFile)) {
				new Notice(`${e.path} no longer exists`);
				return;
			}
			const leaf = this.app.workspace.getLeaf(newPane ? "split" : "tab");
			const eState = e.line ? { line: Math.max(0, e.line - 1) } : undefined;
			void leaf.openFile(file, eState ? { eState } : undefined);
		},
	};
}
