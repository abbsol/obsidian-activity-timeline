import { Plugin, TAbstractFile, TFile } from "obsidian";
import { buildEvents, ClassifyContext, extensionOf, isTracked } from "./classify";
import { lineDiff, LineDiff } from "./linediff";
import type { EventStore } from "./store";
import type { ActivitySettings } from "./types";

const MAX_WAIT_MS = 10 * 60_000;
const MAX_PENDING = 500;
const MAX_SNAPSHOT_FILE_BYTES = 1_000_000;
const MAX_SNAPSHOT_TOTAL_BYTES = 30_000_000;

interface Pending {
	created: boolean;
	firstTs: number;
	timer: number;
}

export interface LiveDeps {
	store: EventStore;
	settings: () => ActivitySettings;
	context: () => ClassifyContext;
	/** Last committed text of a file, when the vault is a git repo. */
	baseline: (path: string) => Promise<string | null>;
}

/**
 * Records edits as they happen. Obsidian only tells us that a file changed, not what changed,
 * so we keep a snapshot of each file we have seen and diff against it when edits settle.
 */
export class LiveRecorder {
	private pending = new Map<string, Pending>();
	private snapshots = new Map<string, string>();
	private snapshotBytes = 0;

	constructor(private plugin: Plugin, private deps: LiveDeps) {}

	register(): void {
		const { workspace, vault } = this.plugin.app;
		workspace.onLayoutReady(() => {
			this.plugin.registerEvent(vault.on("create", (f) => this.touch(f, true)));
			this.plugin.registerEvent(vault.on("modify", (f) => this.touch(f, false)));
			this.plugin.registerEvent(vault.on("delete", (f) => this.forget(f.path)));
			this.plugin.registerEvent(vault.on("rename", (f, oldPath) => this.rename(f, oldPath)));
			this.plugin.registerEvent(
				workspace.on("file-open", (f) => {
					if (f) void this.snapshot(f);
				}),
			);
			const active = workspace.getActiveFile();
			if (active) void this.snapshot(active);
		});
		this.plugin.register(() => this.flushAll());
	}

	private touch(file: TAbstractFile, created: boolean): void {
		if (!(file instanceof TFile)) return;
		if (!isTracked(file.path, this.deps.context())) return;
		const now = Date.now();
		const existing = this.pending.get(file.path);
		if (!existing && this.pending.size >= MAX_PENDING) return; // sync burst, not human activity
		const firstTs = existing?.firstTs ?? now;
		if (existing) window.clearTimeout(existing.timer);
		const groupMs = this.deps.settings().groupSeconds * 1000;
		const delay = Math.max(0, Math.min(groupMs, firstTs + MAX_WAIT_MS - now));
		const timer = window.setTimeout(() => void this.flush(file.path), delay);
		this.pending.set(file.path, { created: (existing?.created ?? false) || created, firstTs, timer });
	}

	private forget(path: string): void {
		const p = this.pending.get(path);
		if (p) window.clearTimeout(p.timer);
		this.pending.delete(path);
		this.dropSnapshot(path);
	}

	private rename(file: TAbstractFile, oldPath: string): void {
		const p = this.pending.get(oldPath);
		if (p) {
			this.pending.delete(oldPath);
			this.pending.set(file.path, p);
		}
		const text = this.snapshots.get(oldPath);
		if (text !== undefined) {
			this.dropSnapshot(oldPath);
			this.setSnapshot(file.path, text);
		}
	}

	private flushAll(): void {
		for (const path of [...this.pending.keys()]) {
			const p = this.pending.get(path);
			if (p) window.clearTimeout(p.timer);
			void this.flush(path);
		}
	}

	private async snapshot(file: TAbstractFile): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (this.snapshots.has(file.path) || file.stat.size > MAX_SNAPSHOT_FILE_BYTES) return;
		try {
			this.setSnapshot(file.path, await this.plugin.app.vault.cachedRead(file));
		} catch {
			// file vanished between the event and the read
		}
	}

	private setSnapshot(path: string, text: string): void {
		this.dropSnapshot(path);
		if (text.length > MAX_SNAPSHOT_FILE_BYTES) return;
		this.snapshots.set(path, text);
		this.snapshotBytes += text.length;
		for (const key of this.snapshots.keys()) {
			if (this.snapshotBytes <= MAX_SNAPSHOT_TOTAL_BYTES) break;
			this.dropSnapshot(key);
		}
	}

	private dropSnapshot(path: string): void {
		const old = this.snapshots.get(path);
		if (old === undefined) return;
		this.snapshots.delete(path);
		this.snapshotBytes -= old.length;
	}

	private async flush(path: string): Promise<void> {
		const p = this.pending.get(path);
		if (!p) return;
		this.pending.delete(path);

		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		let text: string;
		try {
			text = await this.plugin.app.vault.read(file);
		} catch {
			return;
		}

		let diff: LineDiff | null;
		if (p.created) {
			diff = lineDiff(null, text);
		} else {
			const base = this.snapshots.get(path) ?? (await this.deps.baseline(path));
			diff = base === null ? null : lineDiff(base, text);
		}
		if (extensionOf(path) === "md") this.setSnapshot(path, text);

		const ts = p.created ? file.stat.ctime : file.stat.mtime;
		const events = buildEvents(
			{ path, ts, created: p.created, diff, origin: "live", idSeed: `live:${ts}` },
			this.deps.context(),
		);
		this.deps.store.add(events);
	}
}
