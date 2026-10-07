import { DataAdapter, FileSystemAdapter, Notice, Plugin } from "obsidian";
import { ClassifyContext } from "./classify";
import { gitHeadText, importGitHistory, isGitRepo, setGitBinary } from "./git";
import { LiveRecorder } from "./live";
import { ActivityTimelineSettingTab } from "./settings";
import { EventStore, LogStorage } from "./store";
import { ActivitySettings, DEFAULT_SETTINGS } from "./types";
import { TimelineView, VIEW_TYPE } from "./view";

const DAY_MS = 86_400_000;
const GIT_POLL_MS = 5 * 60_000;

class AdapterStorage implements LogStorage {
	constructor(
		private adapter: DataAdapter,
		private path: string,
	) {}

	async read(): Promise<string | null> {
		if (!(await this.adapter.exists(this.path))) return null;
		return this.adapter.read(this.path);
	}

	async append(data: string): Promise<void> {
		if (!(await this.adapter.exists(this.path))) await this.adapter.write(this.path, data);
		else await this.adapter.append(this.path, data);
	}

	async write(data: string): Promise<void> {
		await this.adapter.write(this.path, data);
	}
}

export default class ActivityTimelinePlugin extends Plugin {
	settings: ActivitySettings = { ...DEFAULT_SETTINGS };
	store!: EventStore;
	gitReady = false;
	private importing = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		this.store = new EventStore(new AdapterStorage(this.app.vault.adapter, `${dir}/events.jsonl`), {
			mergeMs: this.settings.mergeMinutes * 60_000,
		});
		await this.store.load();

		this.registerView(VIEW_TYPE, (leaf) => new TimelineView(leaf, this));
		this.addRibbonIcon("history", "Open activity timeline", () => void this.openTimeline());
		this.addCommand({ id: "open-timeline", name: "Open timeline", callback: () => void this.openTimeline() });
		this.addCommand({
			id: "import-git-history",
			name: "Import Git history",
			callback: () => void this.importGit(true),
		});
		this.addSettingTab(new ActivityTimelineSettingTab(this.app, this));

		new LiveRecorder(this, {
			store: this.store,
			settings: () => this.settings,
			context: () => this.classifyContext(),
			baseline: (path) => {
				const cwd = this.basePath();
				return this.gitReady && cwd ? gitHeadText(cwd, path) : Promise.resolve(null);
			},
		}).register();

		this.app.workspace.onLayoutReady(() => void this.initGit());
		this.registerInterval(window.setInterval(() => void this.importGit(false), GIT_POLL_MS));
	}

	onunload(): void {
		void this.store.whenIdle();
	}

	classifyContext(): ClassifyContext {
		return {
			rules: this.settings.captureRules,
			extensions: this.settings.fileExtensions,
			excluded: this.settings.excludedFolders,
		};
	}

	basePath(): string | null {
		const adapter = this.app.vault.adapter;
		return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<ActivitySettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
		setGitBinary(this.settings.gitPath);
	}

	async saveSettings(): Promise<void> {
		this.store.options.mergeMs = this.settings.mergeMinutes * 60_000;
		setGitBinary(this.settings.gitPath);
		await this.saveData(this.settings);
	}

	async openTimeline(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	async initGit(): Promise<void> {
		const cwd = this.basePath();
		if (!this.settings.gitEnabled || !cwd) return;
		this.gitReady = await isGitRepo(cwd);
		if (this.gitReady) await this.importGit(false);
	}

	/** Imports commits newer than the last import (or the backfill window on first run). */
	async importGit(manual: boolean): Promise<void> {
		const cwd = this.basePath();
		if (!cwd || this.importing) return;
		if (!this.settings.gitEnabled) {
			if (manual) new Notice("Git import is turned off in the settings");
			return;
		}
		if (!this.gitReady) {
			this.gitReady = await isGitRepo(cwd);
			if (!this.gitReady) {
				if (manual) new Notice("This vault is not a Git repository, or Git was not found");
				return;
			}
		}

		const first = this.settings.gitImportedUntil === 0;
		const sinceMs = first
			? Date.now() - this.settings.gitBackfillDays * DAY_MS
			: this.settings.gitImportedUntil - 60_000;
		if (first || manual) new Notice("Importing Git history…");

		this.importing = true;
		try {
			const result = await importGitHistory({
				cwd,
				sinceMs,
				ctx: this.classifyContext(),
				maxFilesPerCommit: this.settings.gitMaxFilesPerCommit,
				store: this.store,
			});
			if (result.lastTs > this.settings.gitImportedUntil) {
				this.settings.gitImportedUntil = result.lastTs;
				await this.saveSettings();
			} else if (first) {
				this.settings.gitImportedUntil = Date.now();
				await this.saveSettings();
			}
			if (first || manual) {
				new Notice(`Imported ${result.events} events from ${result.commits} commits`);
			}
		} catch (err) {
			console.error("Activity timeline: git import failed", err);
			if (first || manual) new Notice("Git import failed, see the developer console");
		} finally {
			this.importing = false;
		}
	}

	async clearLog(): Promise<void> {
		await this.store.clear();
		this.settings.gitImportedUntil = 0;
		await this.saveSettings();
	}
}
