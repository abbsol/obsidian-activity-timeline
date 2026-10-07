import type { DayGroup, FolderOption, HeatCell } from "./aggregate";
import { folderOf } from "./aggregate";
import { extensionOf } from "./classify";
import type { ActivityEvent, EventKind, Group, Period } from "./types";

export interface ViewModel {
	period: Period;
	group: Group;
	folder: string;
	rangeLabel: string;
	/** The shown period contains today. */
	isCurrent: boolean;
	days: DayGroup[];
	hiddenDays: number;
	totalEvents: number;
	heat: HeatCell[][];
	heatWeeks: number;
	counts: Record<EventKind, number>;
	folders: FolderOption[];
	todayKey: string;
}

export interface Handlers {
	setPeriod(p: Period): void;
	shift(dir: 1 | -1): void;
	goToday(): void;
	setGroup(g: Group): void;
	setFolder(f: string): void;
	pickDay(d: Date): void;
	openEvent(e: ActivityEvent, newPane: boolean): void;
	showMore(): void;
}

export type IconFn = (el: HTMLElement, name: string) => void;

const PERIODS: [Period, string][] = [
	["day", "Day"],
	["week", "Week"],
	["month", "Month"],
	["year", "Year"],
];

const GROUPS: [Group, string][] = [
	["all", "All"],
	["notes", "Notes"],
	["tasks", "Tasks"],
	["captures", "Captures"],
	["files", "Canvas & snippets"],
];

const BARS: [EventKind, string][] = [
	["note-edited", "Notes edited"],
	["note-created", "Notes created"],
	["capture", "Captures"],
	["task-completed", "Tasks completed"],
	["task-killed", "Tasks killed"],
	["file-changed", "Canvas & snippets"],
];

function fileLabel(path: string): string {
	switch (extensionOf(path)) {
		case "canvas":
			return "Canvas";
		case "css":
			return "Snippet";
		case "base":
			return "Base";
		default:
			return "File";
	}
}

function kindLabel(e: ActivityEvent): string {
	switch (e.kind) {
		case "note-created":
			return "Note created";
		case "note-edited":
			return "Note edited";
		case "capture":
			return e.source ? `Captured · ${e.source}` : "Captured";
		case "task-completed":
			return "Task completed";
		case "task-killed":
			return "Task killed";
		case "file-changed":
			return `${fileLabel(e.path)} ${e.created ? "created" : "edited"}`;
	}
}

function kindIcon(e: ActivityEvent): string {
	switch (e.kind) {
		case "note-created":
			return "file-plus";
		case "note-edited":
			return "pencil";
		case "capture":
			return e.icon || "bookmark";
		case "task-completed":
			return "check";
		case "task-killed":
			return "x";
		case "file-changed":
			return extensionOf(e.path) === "canvas" ? "layout-dashboard" : "file-code";
	}
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function timeLabel(ts: number): string {
	const d = new Date(ts);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const fullFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

export function formatDay(d: Date): string {
	return dayFmt.format(d);
}

export function formatMonth(d: Date): string {
	return monthFmt.format(d);
}

export function formatFullDay(d: Date): string {
	return fullFmt.format(d);
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

export function render(root: HTMLElement, vm: ViewModel, h: Handlers, icon: IconFn): void {
	root.empty();
	const main = root.createDiv({ cls: "at-main" });
	const side = root.createDiv({ cls: "at-side" });
	renderMain(main, vm, h, icon);
	renderSide(side, vm, h);
}

function renderMain(el: HTMLElement, vm: ViewModel, h: Handlers, icon: IconFn): void {
	const head = el.createDiv({ cls: "at-head" });
	head.createEl("h1", { cls: "at-title", text: "Activity timeline" });

	const controls = head.createDiv({ cls: "at-controls" });
	const seg = controls.createDiv({ cls: "at-seg", attr: { role: "group", "aria-label": "Period" } });
	for (const [p, label] of PERIODS) {
		const b = seg.createEl("button", { cls: "at-seg-btn", text: label });
		if (p === vm.period) b.addClass("is-active");
		b.setAttribute("aria-pressed", String(p === vm.period));
		b.addEventListener("click", () => h.setPeriod(p));
	}

	const nav = el.createDiv({ cls: "at-nav" });
	const prev = nav.createEl("button", { cls: "at-nav-btn", attr: { "aria-label": "Previous period" } });
	icon(prev, "chevron-left");
	prev.addEventListener("click", () => h.shift(-1));
	nav.createSpan({ cls: "at-nav-label", text: vm.rangeLabel });
	const next = nav.createEl("button", { cls: "at-nav-btn", attr: { "aria-label": "Next period" } });
	icon(next, "chevron-right");
	next.addEventListener("click", () => h.shift(1));
	const today = nav.createEl("button", { cls: "at-nav-today", text: "Today" });
	if (vm.isCurrent) today.setAttribute("disabled", "true");
	today.addEventListener("click", () => h.goToday());

	const chips = el.createDiv({ cls: "at-chips", attr: { role: "group", "aria-label": "Event type" } });
	for (const [g, label] of GROUPS) {
		const c = chips.createEl("button", { cls: "at-chip", text: label });
		if (g === vm.group) c.addClass("is-active");
		c.setAttribute("aria-pressed", String(g === vm.group));
		c.addEventListener("click", () => h.setGroup(g));
	}

	const list = el.createDiv({ cls: "at-list" });
	if (vm.days.length === 0) {
		const empty = list.createDiv({ cls: "at-empty" });
		empty.createDiv({ cls: "at-empty-title", text: "No activity in this period" });
		empty.createDiv({
			cls: "at-empty-hint",
			text: "Edits show up here as you work. If your vault is a git repository, older history is imported automatically.",
		});
		return;
	}

	let lastMonth = "";
	for (const day of vm.days) {
		const month = formatMonth(day.date);
		if (month !== lastMonth) {
			list.createDiv({ cls: "at-month", text: month });
			lastMonth = month;
		}
		renderDay(list, day, vm, h, icon);
	}
	if (vm.hiddenDays > 0) {
		const more = list.createEl("button", {
			cls: "at-more",
			text: `Show ${plural(vm.hiddenDays, "older day", "older days")}`,
		});
		more.addEventListener("click", () => h.showMore());
	}
}

function renderDay(list: HTMLElement, day: DayGroup, vm: ViewModel, h: Handlers, icon: IconFn): void {
	const section = list.createDiv({ cls: "at-day" });
	const head = section.createDiv({ cls: "at-day-head" });
	head.createEl("strong", { text: formatDay(day.date) });
	head.createSpan({
		cls: "at-day-meta",
		text: day.key === vm.todayKey ? " · Today" : ` · ${plural(day.events.length, "event", "events")}`,
	});
	for (const ev of day.events) renderEvent(section, ev, h, icon);
}

function renderEvent(section: HTMLElement, ev: ActivityEvent, h: Handlers, icon: IconFn): void {
	const item = section.createDiv({ cls: "at-item" });
	item.createDiv({ cls: "at-time", text: timeLabel(ev.ts) });

	const rail = item.createDiv({ cls: "at-rail" });
	const dot = rail.createDiv({ cls: `at-dot at-k-${ev.kind}` });
	icon(dot, kindIcon(ev));

	const card = item.createDiv({
		cls: `at-card at-k-${ev.kind}`,
		attr: { role: "button", tabindex: "0", "aria-label": `${kindLabel(ev)}: ${ev.title}` },
	});
	card.createDiv({ cls: "at-card-label", text: kindLabel(ev) });
	card.createDiv({ cls: "at-card-title", text: ev.title });

	const meta: string[] = [ev.path];
	if (ev.kind === "note-edited" && ev.changes) meta.push(plural(ev.changes, "change", "changes"));
	if ((ev.kind === "task-completed" || ev.kind === "task-killed") && ev.to) {
		meta.push(`[${ev.from ?? " "}] → [${ev.to}]`);
	}
	if (ev.kind === "file-changed" && ev.changes) meta.push(plural(ev.changes, "change", "changes"));
	card.createDiv({ cls: "at-card-meta", text: meta.join(" · ") });

	if (ev.excerpt && ev.excerpt.length > 0) {
		const box = card.createDiv({ cls: "at-excerpt" });
		for (const line of ev.excerpt) box.createDiv({ text: line });
	}

	const open = (newPane: boolean) => h.openEvent(ev, newPane);
	card.addEventListener("click", (e) => open(e.metaKey || e.ctrlKey));
	card.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			open(false);
		}
	});
}

function renderSide(el: HTMLElement, vm: ViewModel, h: Handlers): void {
	el.createDiv({ cls: "at-side-title", text: `Activity · last ${vm.heatWeeks} weeks` });
	const grid = el.createDiv({ cls: "at-heat", attr: { role: "group", "aria-label": "Activity heatmap" } });
	grid.setCssProps({ "--at-heat-cols": String(vm.heat.length) });
	for (const col of vm.heat) {
		for (const cell of col) {
			const label = `${formatFullDay(cell.date)}: ${plural(cell.count, "event", "events")}`;
			const b = grid.createEl("button", {
				cls: `at-cell at-l${cell.level}`,
				attr: { "aria-label": label, title: label },
			});
			if (cell.future) {
				b.addClass("is-future");
				b.setAttribute("disabled", "true");
			}
			if (cell.key === vm.todayKey) b.addClass("is-today");
			b.addEventListener("click", () => h.pickDay(cell.date));
		}
	}

	el.createDiv({ cls: "at-side-title at-gap", text: "By type" });
	const max = Math.max(1, ...BARS.map(([k]) => vm.counts[k]));
	for (const [kind, label] of BARS) {
		const row = el.createDiv({ cls: "at-bar-row" });
		const top = row.createDiv({ cls: "at-bar-top" });
		top.createSpan({ text: label });
		top.createSpan({ cls: "at-bar-count", text: String(vm.counts[kind]) });
		const track = row.createDiv({ cls: "at-bar-track" });
		const fill = track.createDiv({ cls: `at-bar-fill at-k-${kind}` });
		fill.setCssProps({ width: `${Math.round((vm.counts[kind] / max) * 100)}%` });
	}

	el.createDiv({ cls: "at-side-title at-gap", text: "Folder" });
	const select = el.createEl("select", { cls: "at-select dropdown", attr: { "aria-label": "Folder" } });
	const options: FolderOption[] = [{ path: "", count: 0 }, ...vm.folders];
	if (vm.folder && !vm.folders.some((f) => f.path === vm.folder)) options.push({ path: vm.folder, count: 0 });
	for (const f of options) {
		const depth = f.path ? f.path.split("/").length - 1 : 0;
		const opt = select.createEl("option", {
			value: f.path,
			text: f.path ? `${"  ".repeat(depth)}${f.path.slice(folderOf(f.path).length ? folderOf(f.path).length + 1 : 0)}` : "All folders",
		});
		if (f.path === vm.folder) opt.selected = true;
	}
	select.addEventListener("change", () => h.setFolder(select.value));
}

