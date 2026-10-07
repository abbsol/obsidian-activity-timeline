import type { ActivityEvent, CaptureRule, Origin } from "./types";
import type { DiffLine, LineDiff } from "./linediff";

export interface FileChange {
	path: string;
	ts: number;
	created: boolean;
	/** `null` means the previous version is unknown (live edit without a baseline). */
	diff: LineDiff | null;
	origin: Origin;
	/** Makes event ids unique per source change (commit sha, or a live timestamp). */
	idSeed: string;
}

export interface ClassifyContext {
	rules: CaptureRule[];
	extensions: string[];
	excluded: string[];
}

const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/;

export interface ParsedTask {
	status: string;
	body: string;
	key: string;
}

type StatusClass = "done" | "killed" | "open" | "other";

function statusClass(status: string): StatusClass {
	if (status === "x" || status === "X") return "done";
	if (status === "-") return "killed";
	if (status === " ") return "open";
	return "other";
}

const DATE_STAMP = /\s*[✅✓✔❌🚫➕⏳🛫]\uFE0F?\s*\d{4}-\d{2}-\d{2}/gu;

export function cleanInline(input: string, max = 160): string {
	let t = input
		.replace(DATE_STAMP, "")
		.replace(/!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s*#{1,6}\s+/, "")
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "")
		.replace(/^\s*>\s*/, "")
		.replace(/(\*\*|__|~~|`)/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (t.length > max) t = t.slice(0, max - 1).trimEnd() + "…";
	return t;
}

function taskKey(body: string): string {
	return body
		.replace(/!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
		.replace(/(\*\*|__|~~|`)/g, "")
		.replace(/\d{4}-\d{2}-\d{2}/g, "")
		.replace(/[\p{Extended_Pictographic}️]/gu, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.slice(0, 40);
}

export function parseTask(text: string): ParsedTask | null {
	const m = TASK_RE.exec(text);
	if (!m) return null;
	return { status: m[1], body: m[2], key: taskKey(m[2]) };
}

function keysMatch(a: string, b: string): boolean {
	if (a === b) return true;
	if (a.length < 12 || b.length < 12) return false;
	return a.startsWith(b.slice(0, 20)) || b.startsWith(a.slice(0, 20));
}

interface TaskLine extends ParsedTask {
	idx: number;
	line: number;
}

function collectTasks(lines: DiffLine[]): TaskLine[] {
	const out: TaskLine[] = [];
	lines.forEach((l, idx) => {
		const t = parseTask(l.text);
		if (t) out.push({ ...t, idx, line: l.line });
	});
	return out;
}

interface TaskTransition {
	kind: "task-completed" | "task-killed";
	task: TaskLine;
	from?: string;
}

interface TaskScan {
	transitions: TaskTransition[];
	consumedAdded: Set<number>;
	consumedRemoved: Set<number>;
}

function scanTasks(diff: LineDiff): TaskScan {
	const added = collectTasks(diff.added);
	const removed = collectTasks(diff.removed);
	const usedRemoved = new Set<number>();
	const consumedAdded = new Set<number>();
	const transitions: TaskTransition[] = [];

	for (const a of added) {
		const r = removed.find((x) => !usedRemoved.has(x.idx) && keysMatch(a.key, x.key));
		if (r) usedRemoved.add(r.idx);
		const to = statusClass(a.status);
		// a task line is "activity of its own" when matched to a removed line or closed;
		// a brand new open task stays a plain note edit
		if (r || to === "done" || to === "killed") consumedAdded.add(a.idx);
		const from = r ? statusClass(r.status) : null;
		if (from === to) continue; // moved or reworded, status unchanged
		if (to === "done") transitions.push({ kind: "task-completed", task: a, from: r?.status });
		else if (to === "killed") transitions.push({ kind: "task-killed", task: a, from: r?.status });
	}

	const consumedRemoved = new Set<number>(usedRemoved);
	return { transitions, consumedAdded, consumedRemoved };
}

const YAML_LINE = /^[a-z_][\w-]*:(\s|$)/;

export function buildExcerpt(added: DiffLine[], title?: string): string[] {
	const out: string[] = [];
	let inFrontmatter = false;
	for (const { line, text } of added) {
		const t = text.trim();
		if (t === "---") {
			if (line === 1) inFrontmatter = true;
			else inFrontmatter = false;
			continue;
		}
		if (inFrontmatter || !t) continue;
		if (/^(```|~~~|%%)/.test(t) || YAML_LINE.test(t)) continue;
		const cleaned = cleanInline(t);
		if (!cleaned || (title && cleaned.toLowerCase() === title.toLowerCase())) continue;
		out.push(cleaned);
		if (out.length >= 2) break;
	}
	return out;
}

export function isExcluded(path: string, excluded: string[]): boolean {
	return excluded.some((f) => {
		const folder = f.replace(/^\/+|\/+$/g, "");
		return folder !== "" && (path === folder || path.startsWith(folder + "/"));
	});
}

export function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function titleOf(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? name : name.slice(0, dot);
}

export function isTracked(path: string, ctx: Pick<ClassifyContext, "extensions" | "excluded">): boolean {
	if (isExcluded(path, ctx.excluded)) return false;
	const ext = extensionOf(path);
	return ext === "md" || ctx.extensions.includes(ext);
}

function patternToRegExp(pattern: string): RegExp {
	const body = pattern
		.replace(/^\/+/, "")
		.split("*")
		.map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join("[^/]*");
	return new RegExp("^" + body);
}

export function matchCaptureRule(path: string, rules: CaptureRule[]): CaptureRule | null {
	for (const rule of rules) {
		if (!rule.pattern.trim()) continue;
		if (patternToRegExp(rule.pattern.trim()).test(path)) return rule;
	}
	return null;
}

function nonBlank(lines: DiffLine[], skip: Set<number>): DiffLine[] {
	return lines.filter((l, idx) => !skip.has(idx) && l.text.trim() !== "");
}

export function buildEvents(change: FileChange, ctx: ClassifyContext): ActivityEvent[] {
	const { path, ts, origin, idSeed } = change;
	if (!isTracked(path, ctx)) return [];

	const base = { ts, path, origin };
	const mk = (kind: ActivityEvent["kind"], suffix: string, extra: Partial<ActivityEvent>): ActivityEvent => ({
		id: `${idSeed}|${kind}|${path}|${suffix}`,
		kind,
		title: titleOf(path),
		...base,
		...extra,
	});

	const ext = extensionOf(path);
	if (ext !== "md") {
		const count = change.diff ? change.diff.added.length + change.diff.removed.length : undefined;
		if (!change.created && change.diff && count === 0) return [];
		return [mk("file-changed", "", { created: change.created, changes: count })];
	}

	if (change.created) {
		const added = change.diff?.added ?? [];
		const excerpt = buildExcerpt(added, titleOf(path));
		const rule = matchCaptureRule(path, ctx.rules);
		if (rule) {
			return [mk("capture", "", { source: rule.name, icon: rule.icon, excerpt, line: 1 })];
		}
		return [mk("note-created", "", { excerpt, line: 1 })];
	}

	if (!change.diff) return [mk("note-edited", "", {})];

	const { transitions, consumedAdded, consumedRemoved } = scanTasks(change.diff);
	const events: ActivityEvent[] = [];
	const seen = new Map<string, number>();
	for (const tr of transitions) {
		const n = seen.get(tr.task.key) ?? 0;
		seen.set(tr.task.key, n + 1);
		events.push(
			mk(tr.kind, `${tr.task.key}#${n}`, {
				title: cleanInline(tr.task.body, 140).replace(/^[\s✅✓✔☑\uFE0F]+/u, ""),
				task: tr.task.key,
				from: tr.from,
				to: tr.task.status,
				line: tr.task.line,
			}),
		);
	}

	const rest = nonBlank(change.diff.added, consumedAdded);
	const restRemoved = nonBlank(change.diff.removed, consumedRemoved);
	const changes = rest.length + restRemoved.length;
	if (changes > 0) {
		const excerpt = buildExcerpt(rest, titleOf(path));
		events.push(
			mk("note-edited", "", {
				changes,
				excerpt,
				line: rest[0]?.line ?? restRemoved[0]?.line,
			}),
		);
	}
	return events;
}
