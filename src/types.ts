export type EventKind =
	| "note-created"
	| "note-edited"
	| "capture"
	| "task-completed"
	| "task-killed"
	| "file-changed";

export type Origin = "live" | "git";

export interface ActivityEvent {
	id: string;
	ts: number;
	kind: EventKind;
	path: string;
	/** Note title, or the cleaned task text for task events. */
	title: string;
	origin: Origin;
	/** Number of changed non-blank lines (added + removed). */
	changes?: number;
	/** Up to two cleaned lines of changed text. */
	excerpt?: string[];
	/** 1-based line in the new version, used to jump into the note. */
	line?: number;
	/** Capture rule name. */
	source?: string;
	/** Capture rule icon (lucide name). */
	icon?: string;
	/** Normalized task key, used to match and deduplicate task events. */
	task?: string;
	/** Task status character before and after. */
	from?: string;
	to?: string;
	/** For file-changed: the file was created, not edited. */
	created?: boolean;
	/** Reconstructed from file dates, not from a commit or a live edit. */
	approx?: boolean;
}

export interface CaptureRule {
	name: string;
	/** Path prefix. `*` matches within one path segment. */
	pattern: string;
	/** Lucide icon name. */
	icon: string;
}

export interface ActivitySettings {
	groupSeconds: number;
	mergeMinutes: number;
	excludedFolders: string[];
	fileExtensions: string[];
	captureRules: CaptureRule[];
	gitEnabled: boolean;
	gitPath: string;
	/** Ref to read history from, for example HEAD or origin/main. */
	gitRef: string;
	/** Run `git fetch` before each import. */
	gitFetch: boolean;
	gitBackfillDays: number;
	gitMaxFilesPerCommit: number;
	weekStartsOnMonday: boolean;
	/** Keep notes in memory so changes made outside the editor can be diffed. */
	preloadNotes: boolean;
	/** Commit time (ms) up to which git history has been imported. */
	gitImportedUntil: number;
}

export const DEFAULT_SETTINGS: ActivitySettings = {
	groupSeconds: 60,
	mergeMinutes: 30,
	excludedFolders: [".trash"],
	fileExtensions: ["canvas", "base", "css"],
	captureRules: [],
	gitEnabled: true,
	gitPath: "git",
	gitRef: "HEAD",
	gitFetch: false,
	gitBackfillDays: 365,
	gitMaxFilesPerCommit: 300,
	weekStartsOnMonday: true,
	preloadNotes: true,
	gitImportedUntil: 0,
};

export type Period = "day" | "week" | "month" | "year";
export type Group = "all" | "notes" | "tasks" | "captures" | "files";

export const GROUP_KINDS: Record<Group, EventKind[] | null> = {
	all: null,
	notes: ["note-created", "note-edited"],
	tasks: ["task-completed", "task-killed"],
	captures: ["capture"],
	files: ["file-changed"],
};
