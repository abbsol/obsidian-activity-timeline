import { ActivityEvent, EventKind, GROUP_KINDS, Group, Period } from "./types";

export const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function dayKey(ts: number | Date): string {
	const d = typeof ts === "number" ? new Date(ts) : ts;
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfWeek(d: Date, mondayFirst: boolean): Date {
	const sod = startOfDay(d);
	const dow = sod.getDay(); // 0 = Sunday
	const offset = mondayFirst ? (dow + 6) % 7 : dow;
	return addDays(sod, -offset);
}

export interface Range {
	from: number;
	/** Exclusive. */
	to: number;
}

export function periodRange(period: Period, anchor: Date, mondayFirst: boolean): Range {
	const day = startOfDay(anchor);
	switch (period) {
		case "day":
			return { from: day.getTime(), to: addDays(day, 1).getTime() };
		case "week": {
			const from = startOfWeek(day, mondayFirst);
			return { from: from.getTime(), to: addDays(from, 7).getTime() };
		}
		case "month":
			return {
				from: new Date(day.getFullYear(), day.getMonth(), 1).getTime(),
				to: new Date(day.getFullYear(), day.getMonth() + 1, 1).getTime(),
			};
		case "year":
			return {
				from: new Date(day.getFullYear(), 0, 1).getTime(),
				to: new Date(day.getFullYear() + 1, 0, 1).getTime(),
			};
	}
}

export function shiftAnchor(period: Period, anchor: Date, dir: 1 | -1): Date {
	const d = startOfDay(anchor);
	switch (period) {
		case "day":
			return addDays(d, dir);
		case "week":
			return addDays(d, 7 * dir);
		case "month":
			return new Date(d.getFullYear(), d.getMonth() + dir, 1);
		case "year":
			return new Date(d.getFullYear() + dir, 0, 1);
	}
}

export function folderOf(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

export interface Filter {
	from?: number;
	to?: number;
	group?: Group;
	/** Folder prefix; empty means the whole vault. */
	folder?: string;
}

export function matchesFolder(path: string, folder: string): boolean {
	if (!folder) return true;
	return path === folder || path.startsWith(folder + "/");
}

export function filterEvents(events: ActivityEvent[], f: Filter): ActivityEvent[] {
	const kinds = f.group ? GROUP_KINDS[f.group] : null;
	return events.filter(
		(e) =>
			(f.from === undefined || e.ts >= f.from) &&
			(f.to === undefined || e.ts < f.to) &&
			(!kinds || kinds.includes(e.kind)) &&
			(!f.folder || matchesFolder(e.path, f.folder)),
	);
}

export interface DayGroup {
	key: string;
	date: Date;
	events: ActivityEvent[];
}

/** Newest day first, newest event first within a day. */
export function groupByDay(events: ActivityEvent[]): DayGroup[] {
	const byDay = new Map<string, DayGroup>();
	for (const e of events) {
		const key = dayKey(e.ts);
		let g = byDay.get(key);
		if (!g) {
			g = { key, date: startOfDay(new Date(e.ts)), events: [] };
			byDay.set(key, g);
		}
		g.events.push(e);
	}
	const groups = [...byDay.values()];
	groups.sort((a, b) => b.date.getTime() - a.date.getTime());
	for (const g of groups) g.events.sort((a, b) => b.ts - a.ts);
	return groups;
}

export function countByKind(events: ActivityEvent[]): Record<EventKind, number> {
	const out: Record<EventKind, number> = {
		"note-created": 0,
		"note-edited": 0,
		capture: 0,
		"task-completed": 0,
		"task-killed": 0,
		"file-changed": 0,
	};
	for (const e of events) out[e.kind]++;
	return out;
}

export interface HeatCell {
	key: string;
	date: Date;
	count: number;
	level: 0 | 1 | 2 | 3 | 4;
	future: boolean;
}

/** `weeks` columns of 7 days, the last column is the week containing `today`. */
export function buildHeatmap(
	events: ActivityEvent[],
	today: Date,
	weeks: number,
	mondayFirst: boolean,
): HeatCell[][] {
	const lastWeekStart = startOfWeek(today, mondayFirst);
	const firstDay = addDays(lastWeekStart, -(weeks - 1) * 7);
	const counts = new Map<string, number>();
	const from = firstDay.getTime();
	const to = addDays(lastWeekStart, 7).getTime();
	for (const e of events) {
		if (e.ts < from || e.ts >= to) continue;
		const k = dayKey(e.ts);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	const max = Math.max(0, ...counts.values());
	const todayTs = startOfDay(today).getTime();
	const cols: HeatCell[][] = [];
	for (let w = 0; w < weeks; w++) {
		const col: HeatCell[] = [];
		for (let d = 0; d < 7; d++) {
			const date = addDays(firstDay, w * 7 + d);
			const key = dayKey(date);
			const count = counts.get(key) ?? 0;
			col.push({ key, date, count, level: heatLevel(count, max), future: date.getTime() > todayTs });
		}
		cols.push(col);
	}
	return cols;
}

function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
	if (count <= 0 || max <= 0) return 0;
	const r = count / max;
	if (r > 0.75) return 4;
	if (r > 0.5) return 3;
	if (r > 0.25) return 2;
	return 1;
}

export interface FolderOption {
	path: string;
	count: number;
}

/** Folders (up to `depth` levels) that have events, busiest first. */
export function listFolders(events: ActivityEvent[], depth = 2): FolderOption[] {
	const counts = new Map<string, number>();
	for (const e of events) {
		const parts = folderOf(e.path).split("/").filter(Boolean);
		for (let i = 1; i <= Math.min(depth, parts.length); i++) {
			const p = parts.slice(0, i).join("/");
			counts.set(p, (counts.get(p) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([path, count]) => ({ path, count }))
		.sort((a, b) => a.path.localeCompare(b.path));
}
