import { buildHeatmap, countByKind, dayKey, filterEvents, groupByDay, listFolders, startOfDay } from "../../src/aggregate";
import { render, formatMonth, ViewModel } from "../../src/ui";
import type { ActivityEvent } from "../../src/types";

declare const ICONS: Record<string, string>;

// Obsidian's DOM helpers, just enough for the renderer
const P = HTMLElement.prototype as any;
P.empty = function () { this.replaceChildren(); };
P.addClass = function (c: string) { this.classList.add(c); };
P.setCssProps = function (p: Record<string, string>) { for (const k in p) this.style.setProperty(k, p[k]); };
function mk(parent: HTMLElement, tag: string, o: any = {}) {
	const el = document.createElement(tag);
	if (o.cls) el.className = o.cls;
	if (o.text !== undefined) el.textContent = o.text;
	if (o.value !== undefined) (el as any).value = o.value;
	if (o.attr) for (const k in o.attr) el.setAttribute(k, o.attr[k]);
	parent.appendChild(el);
	return el;
}
P.createEl = function (tag: string, o?: any) { return mk(this, tag, o); };
P.createDiv = function (o?: any) { return mk(this, "div", o); };
P.createSpan = function (o?: any) { return mk(this, "span", o); };

const d = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m).getTime();
const base = { origin: "live" as const };
const events: ActivityEvent[] = [
	{ ...base, id: "1", ts: d(6, 9, 12), kind: "capture", source: "Web clips", icon: "bookmark", path: "Web clips/How to write a good README.md", title: "How to write a good README", excerpt: ["A README should say what the project does, who it is for and how to start in under a minute.", "Show a screenshot early: people decide in the first screen."] },
	{ ...base, id: "2", ts: d(6, 8, 40), kind: "task-completed", path: "Tasks/Work.md", title: "Send the quarterly report to finance", from: " ", to: "x", line: 14 },
	{ ...base, id: "3", ts: d(5, 17, 5), kind: "task-killed", path: "Tasks/Work.md", title: "Rewrite the onboarding doc from scratch", from: " ", to: "-", line: 9 },
	{ ...base, id: "4", ts: d(5, 14, 20), kind: "capture", source: "Meeting transcripts", icon: "mic", path: "Transcripts/2026-10-05 Weekly sync.md", title: "2026-10-05 Weekly sync", excerpt: ["Agreed to move the launch to the 19th.", "Open question: who owns the migration checklist?"] },
	{ ...base, id: "5", ts: d(5, 11, 2), kind: "note-edited", path: "Notes/Reading list.md", title: "Reading list", changes: 7, excerpt: ["Finished chapter 4. The argument about sunk costs is the strongest part so far.", "Next: the case studies in chapter 5."] },
	{ ...base, id: "6", ts: d(5, 10, 0), kind: "note-created", path: "Ideas/Weekly review template.md", title: "Weekly review template", excerpt: ["What moved forward this week?", "What got stuck, and why?"] },
	{ ...base, id: "7", ts: d(4, 16, 0), kind: "file-changed", path: "Boards/Roadmap.canvas", title: "Roadmap", changes: 12 },
];
// fake heat history
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 1; i < 70; i++) {
	const day = new Date(2026, 9, 6 - i);
	const n = Math.floor(rnd() * rnd() * 14);
	for (let k = 0; k < n; k++) events.push({ ...base, id: `h${i}-${k}`, ts: day.getTime() + 9 * 3600e3 + k * 60e3, kind: rnd() > 0.5 ? "note-edited" : "note-created", path: `Projects/P${k % 3}/n.md`, title: "x" });
}

const params = new URLSearchParams(location.search);
const now = new Date(2026, 9, 6, 12, 0);
const from = new Date(2026, 9, 5).getTime();
const to = new Date(2026, 9, 12).getTime();
const inRange = filterEvents(events, { from, to });
const groups = groupByDay(inRange);
const vm: ViewModel = {
	period: "week", group: (params.get("group") as any) || "all", folder: "",
	rangeLabel: "Mon, Oct 5 – Sun, Oct 11", isCurrent: true,
	days: groups, hiddenDays: 0, totalEvents: inRange.length,
	heat: buildHeatmap(events, now, 10, true), heatWeeks: 10,
	counts: countByKind(inRange), folders: listFolders(inRange), todayKey: dayKey(now),
};
const root = document.getElementById("root")!;
render(root, vm, new Proxy({}, { get: () => () => {} }) as any, (el, name) => { el.innerHTML = ICONS[name] ?? ""; const s = el.firstElementChild; if (s) s.classList.add("svg-icon"); });
