import type { ActivityEvent, EventKind } from "./types";

/** Where the event log lives. Implemented over the vault adapter in the plugin, in memory in tests. */
export interface LogStorage {
	read(): Promise<string | null>;
	append(data: string): Promise<void>;
	write(data: string): Promise<void>;
}

export interface StoreOptions {
	/** Edits of the same note closer than this are merged into one session. */
	mergeMs: number;
}

type DedupeGroup = "created" | "edited" | "task" | "file";

function groupOf(kind: EventKind): DedupeGroup {
	switch (kind) {
		case "note-created":
		case "capture":
			return "created";
		case "note-edited":
			return "edited";
		case "file-changed":
			return "file";
		default:
			return "task";
	}
}

const DEDUPE_BEFORE_MS = 15 * 60_000;
const DEDUPE_AFTER_MS = 2 * 60_000;

export class EventStore {
	private events = new Map<string, ActivityEvent>();
	private byPath = new Map<string, ActivityEvent[]>();
	private sorted: ActivityEvent[] | null = null;
	private listeners = new Set<() => void>();
	private pendingLines: string[] = [];
	private flushing: Promise<void> = Promise.resolve();
	private lineCount = 0;

	constructor(
		private storage: LogStorage,
		public options: StoreOptions,
	) {}

	async load(): Promise<void> {
		const raw = await this.storage.read();
		this.events.clear();
		this.byPath.clear();
		this.sorted = null;
		this.lineCount = 0;
		if (!raw) return;
		for (const line of raw.split("\n")) {
			if (!line) continue;
			this.lineCount++;
			try {
				const ev = JSON.parse(line) as ActivityEvent;
				if (ev && typeof ev.id === "string" && typeof ev.ts === "number") this.index(ev);
			} catch {
				// a torn last line after a crash is not worth failing the load
			}
		}
		if (this.lineCount > this.events.size * 2 + 200) await this.compact();
	}

	private index(ev: ActivityEvent): void {
		const prev = this.events.get(ev.id);
		this.events.set(ev.id, ev);
		this.sorted = null;
		let list = this.byPath.get(ev.path);
		if (!list) {
			list = [];
			this.byPath.set(ev.path, list);
		}
		if (prev) {
			const i = list.findIndex((x) => x.id === ev.id);
			if (i >= 0) list[i] = ev;
			else list.push(ev);
		} else {
			list.push(ev);
		}
	}

	private persist(ev: ActivityEvent): void {
		this.pendingLines.push(JSON.stringify(ev));
		this.lineCount++;
		this.flushing = this.flushing.then(() => this.flush());
	}

	private async flush(): Promise<void> {
		if (this.pendingLines.length === 0) return;
		const data = this.pendingLines.join("\n") + "\n";
		this.pendingLines = [];
		await this.storage.append(data);
	}

	async whenIdle(): Promise<void> {
		await this.flushing;
	}

	private async compact(): Promise<void> {
		const data = this.all()
			.map((e) => JSON.stringify(e))
			.join("\n");
		await this.storage.write(data ? data + "\n" : "");
		this.lineCount = this.events.size;
	}

	async clear(): Promise<void> {
		this.events.clear();
		this.byPath.clear();
		this.sorted = null;
		this.pendingLines = [];
		await this.flushing;
		await this.storage.write("");
		this.lineCount = 0;
		this.emit();
	}

	/** All events, oldest first. */
	all(): ActivityEvent[] {
		if (!this.sorted) this.sorted = [...this.events.values()].sort((a, b) => a.ts - b.ts);
		return this.sorted;
	}

	get size(): number {
		return this.events.size;
	}

	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(): void {
		for (const fn of this.listeners) fn();
	}

	/**
	 * Adds events produced by one change. Returns how many were stored.
	 * Edits of the same note within `mergeMs` collapse into one session;
	 * a git event is dropped when a live event already covers the same thing.
	 */
	add(events: ActivityEvent[]): number {
		let stored = 0;
		for (const ev of events) {
			if (this.events.has(ev.id)) continue;
			if (ev.origin === "git" && this.coveredByLive(ev)) continue;
			const merged = ev.kind === "note-edited" ? this.mergeEdit(ev) : null;
			const final = merged ?? ev;
			this.index(final);
			this.persist(final);
			stored++;
		}
		if (stored > 0) this.emit();
		return stored;
	}

	private mergeEdit(ev: ActivityEvent): ActivityEvent | null {
		const list = this.byPath.get(ev.path);
		if (!list) return null;
		let last: ActivityEvent | null = null;
		for (const x of list) {
			if (x.kind !== "note-edited") continue;
			if (Math.abs(ev.ts - x.ts) > this.options.mergeMs) continue;
			if (!last || x.ts > last.ts) last = x;
		}
		if (!last) return null;
		return {
			...last,
			ts: Math.max(last.ts, ev.ts),
			changes: (last.changes ?? 0) + (ev.changes ?? 0) || undefined,
			excerpt: last.excerpt && last.excerpt.length > 0 ? last.excerpt : ev.excerpt,
			line: last.line ?? ev.line,
		};
	}

	private coveredByLive(ev: ActivityEvent): boolean {
		const list = this.byPath.get(ev.path);
		if (!list) return false;
		const group = groupOf(ev.kind);
		return list.some(
			(x) =>
				x.origin === "live" &&
				groupOf(x.kind) === group &&
				(group !== "task" || (x.kind === ev.kind && x.task === ev.task)) &&
				ev.ts - x.ts <= DEDUPE_BEFORE_MS &&
				x.ts - ev.ts <= DEDUPE_AFTER_MS,
		);
	}
}
