import { describe, expect, it } from "vitest";
import { EventStore, LogStorage } from "../src/store";
import type { ActivityEvent } from "../src/types";
import { buildHeatmap, filterEvents, groupByDay, listFolders, periodRange, shiftAnchor } from "../src/aggregate";

class MemStorage implements LogStorage {
	data = "";
	async read() { return this.data || null; }
	async append(d: string) { this.data += d; }
	async write(d: string) { this.data = d; }
}
const ev = (over: Partial<ActivityEvent>): ActivityEvent => ({
	id: Math.random().toString(36), ts: 0, kind: "note-edited", path: "a/b.md", title: "b", origin: "live", ...over,
});

describe("EventStore", () => {
	it("merges edits of one note within the window", async () => {
		const s = new EventStore(new MemStorage(), { mergeMs: 30 * 60_000 });
		s.add([ev({ ts: 1_000, changes: 2, excerpt: ["first"] })]);
		s.add([ev({ ts: 5 * 60_000, changes: 3, excerpt: ["second"] })]);
		expect(s.all()).toHaveLength(1);
		expect(s.all()[0].changes).toBe(5);
		expect(s.all()[0].excerpt).toEqual(["first"]);
		expect(s.all()[0].ts).toBe(5 * 60_000);
		s.add([ev({ ts: 90 * 60_000 })]);
		expect(s.all()).toHaveLength(2);
	});
	it("drops a git event covered by a live one, keeps distant ones", () => {
		const s = new EventStore(new MemStorage(), { mergeMs: 0 });
		s.add([ev({ id: "l1", ts: 10 * 60_000, origin: "live" })]);
		expect(s.add([ev({ id: "g1", ts: 12 * 60_000, origin: "git" })])).toBe(0);
		expect(s.add([ev({ id: "g2", ts: 120 * 60_000, origin: "git" })])).toBe(1);
	});
	it("task dedupe is per task key", () => {
		const s = new EventStore(new MemStorage(), { mergeMs: 0 });
		s.add([ev({ id: "l", kind: "task-completed", task: "a", ts: 1000 })]);
		expect(s.add([ev({ id: "g", kind: "task-completed", task: "a", ts: 2000, origin: "git" })])).toBe(0);
		expect(s.add([ev({ id: "g2", kind: "task-completed", task: "b", ts: 2000, origin: "git" })])).toBe(1);
	});
	it("persists and reloads, last upsert wins", async () => {
		const st = new MemStorage();
		const s = new EventStore(st, { mergeMs: 30 * 60_000 });
		s.add([ev({ id: "x", ts: 1000, changes: 1 })]);
		s.add([ev({ id: "y", ts: 2000, changes: 1 })]);
		await s.whenIdle();
		const s2 = new EventStore(st, { mergeMs: 0 });
		await s2.load();
		expect(s2.all()).toHaveLength(1);
		expect(s2.all()[0].changes).toBe(2);
	});
	it("ignores duplicate ids", () => {
		const s = new EventStore(new MemStorage(), { mergeMs: 0 });
		expect(s.add([ev({ id: "same" }), ev({ id: "same" })])).toBe(1);
	});
});

describe("aggregate", () => {
	it("week range is Mon-Sun", () => {
		const r = periodRange("week", new Date(2026, 9, 6), true); // Tue Oct 6 2026
		expect(new Date(r.from).getDate()).toBe(5);
		expect(new Date(r.to).getDate()).toBe(12);
	});
	it("month shifts", () => {
		expect(shiftAnchor("month", new Date(2026, 9, 6), -1).getMonth()).toBe(8);
	});
	it("groups by day newest first and builds heatmap", () => {
		const d = (day: number, h: number) => new Date(2026, 9, day, h).getTime();
		const events = [ev({ ts: d(5, 10) }), ev({ ts: d(6, 9) }), ev({ ts: d(6, 12), path: "x/y/z.md" })];
		const g = groupByDay(events);
		expect(g.map((x) => x.key)).toEqual(["2026-10-06", "2026-10-05"]);
		expect(g[0].events[0].ts).toBe(d(6, 12));
		const heat = buildHeatmap(events, new Date(2026, 9, 6), 10, true);
		expect(heat).toHaveLength(10);
		expect(heat[9][1].count).toBe(2); // Tuesday of last week
		expect(heat[9][1].level).toBe(4);
		expect(heat[9][5].future).toBe(true);
	});
	it("filters and lists folders", () => {
		const events = [ev({ path: "A/B/c.md" }), ev({ path: "A/d.md", kind: "capture" })];
		expect(filterEvents(events, { folder: "A/B" })).toHaveLength(1);
		expect(filterEvents(events, { group: "captures" })).toHaveLength(1);
		expect(listFolders(events).map((f) => f.path)).toEqual(["A", "A/B"]);
	});
});
