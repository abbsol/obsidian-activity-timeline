import { execFile, spawn } from "child_process";
import { createInterface } from "readline";
import { buildEvents, ClassifyContext } from "./classify";
import type { DiffLine } from "./linediff";
import type { EventStore } from "./store";

const MAX_LINES_PER_FILE = 4000;
export const COMMIT_MARKER = "@@@C";

let gitBinary = "git";

export function setGitBinary(path: string): void {
	gitBinary = path.trim() || "git";
}

/** Refs come from settings and end up on a command line, so keep them to ref-like characters. */
export function safeRef(ref: string): string {
	const r = ref.trim();
	return /^[\w][\w./@{}~^-]*$/.test(r) ? r : "HEAD";
}

/** GUI apps on macOS start with a minimal PATH that lacks Homebrew. */
function gitEnv(): NodeJS.ProcessEnv {
	const extra = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
	const current = process.env.PATH ?? "";
	return { ...process.env, PATH: [current, ...extra].filter(Boolean).join(":"), GIT_OPTIONAL_LOCKS: "0" };
}

export interface ParsedFile {
	path: string;
	created: boolean;
	deleted: boolean;
	added: DiffLine[];
	removed: DiffLine[];
}

export interface ParsedCommit {
	sha: string;
	/** Commit time in ms. */
	ts: number;
	files: ParsedFile[];
}

function unquotePath(raw: string): string {
	let p = raw.replace(/\t+$/, "");
	if (p.startsWith('"') && p.endsWith('"')) {
		try {
			p = JSON.parse(p) as string;
		} catch {
			p = p.slice(1, -1);
		}
	}
	return p;
}

function stripPrefix(p: string): string {
	return p.replace(/^[ab]\//, "");
}

/**
 * Line-by-line parser for
 * `git log -p -U0 --format=@@@C%x09%H%x09%ct`.
 * Commits touching more than `maxFiles` files (bulk imports, mass renames) are skipped.
 */
export class GitLogParser {
	skippedCommits = 0;
	private commit: ParsedCommit | null = null;
	private commitFileCount = 0;
	private file: ParsedFile | null = null;
	private inHunk = false;
	private newLine = 0;
	private oldPath: string | null = null;

	constructor(
		private onCommit: (c: ParsedCommit) => void,
		private maxFiles: number,
	) {}

	push(line: string): void {
		if (line.startsWith(COMMIT_MARKER + "\t")) {
			this.finishCommit();
			const [, sha, ct] = line.split("\t");
			this.commit = { sha, ts: Number(ct) * 1000, files: [] };
			this.commitFileCount = 0;
			return;
		}
		if (!this.commit) return;

		if (line.startsWith("diff --git ")) {
			this.finishFile();
			this.file = { path: "", created: false, deleted: false, added: [], removed: [] };
			this.commitFileCount++;
			this.inHunk = false;
			this.oldPath = null;
			return;
		}
		if (!this.file) return;

		if (!this.inHunk) {
			if (line.startsWith("new file mode")) this.file.created = true;
			else if (line.startsWith("deleted file mode")) this.file.deleted = true;
			else if (line.startsWith("--- ")) {
				const p = line.slice(4);
				if (p !== "/dev/null") this.oldPath = stripPrefix(unquotePath(p));
			} else if (line.startsWith("+++ ")) {
				const p = line.slice(4);
				if (p === "/dev/null") {
					this.file.deleted = true;
					this.file.path = this.oldPath ?? "";
				} else {
					this.file.path = stripPrefix(unquotePath(p));
				}
			} else if (line.startsWith("@@")) {
				this.startHunk(line);
			}
			return;
		}

		if (line.startsWith("@@")) {
			this.startHunk(line);
			return;
		}
		const c = line.charAt(0);
		if (c === "+") {
			if (this.file.added.length < MAX_LINES_PER_FILE) {
				this.file.added.push({ line: this.newLine, text: line.slice(1).replace(/\r$/, "") });
			}
			this.newLine++;
		} else if (c === "-") {
			if (this.file.removed.length < MAX_LINES_PER_FILE) {
				this.file.removed.push({ line: this.newLine, text: line.slice(1).replace(/\r$/, "") });
			}
		}
	}

	private startHunk(header: string): void {
		const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
		this.newLine = m ? Number(m[1]) : 1;
		this.inHunk = true;
	}

	private finishFile(): void {
		if (this.file && this.commit && this.file.path) this.commit.files.push(this.file);
		this.file = null;
		this.inHunk = false;
	}

	private finishCommit(): void {
		this.finishFile();
		if (!this.commit) return;
		if (this.commitFileCount > this.maxFiles) this.skippedCommits++;
		else if (this.commit.files.length > 0) this.onCommit(this.commit);
		this.commit = null;
	}

	end(): void {
		this.finishCommit();
	}
}

export function pathspecsFor(extensions: string[]): string[] {
	return ["md", ...extensions].map((e) => `*.${e}`);
}

export function isGitRepo(cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(gitBinary, ["rev-parse", "--is-inside-work-tree"], { cwd, env: gitEnv() }, (err, stdout) => {
			resolve(!err && stdout.trim() === "true");
		});
	});
}

/** The last committed text of a file, or `null` if it is not tracked yet. */
export function gitHeadText(cwd: string, path: string, ref = "HEAD"): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(
			gitBinary,
			["show", `${safeRef(ref)}:./${path}`],
			{ cwd, env: gitEnv(), maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
			(err, stdout) => resolve(err ? null : stdout),
		);
	});
}

export interface ImportResult {
	commits: number;
	events: number;
	skippedCommits: number;
	/** Newest commit time seen, in ms. */
	lastTs: number;
}

/** Runs git and feeds stdout to `onLine` line by line. Rejects on a non-zero exit. */
function streamGit(args: string[], cwd: string, onLine: (line: string) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(gitBinary, args, { cwd, env: gitEnv() });
		let stderr = "";
		child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
		rl.on("line", onLine);
		let exitCode: number | null | undefined;
		let linesDone = false;
		const settle = () => {
			if (exitCode === undefined || !linesDone) return;
			if (exitCode === 0) resolve();
			else reject(new Error(stderr.trim() || `git exited with code ${String(exitCode)}`));
		};
		rl.on("close", () => {
			linesDone = true;
			settle();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			exitCode = code;
			settle();
		});
	});
}

export async function importGitHistory(opts: {
	cwd: string;
	sinceMs: number;
	ctx: ClassifyContext;
	maxFilesPerCommit: number;
	store: EventStore;
	ref: string;
}): Promise<ImportResult> {
	const { cwd, sinceMs, ctx, maxFilesPerCommit, store } = opts;
	const result: ImportResult = { commits: 0, events: 0, skippedCommits: 0, lastTs: 0 };
	const parser = new GitLogParser((commit) => {
		result.commits++;
		result.lastTs = Math.max(result.lastTs, commit.ts);
		for (const f of commit.files) {
			if (f.deleted) continue;
			const events = buildEvents(
				{
					path: f.path,
					ts: commit.ts,
					created: f.created,
					diff: { added: f.added, removed: f.removed },
					origin: "git",
					idSeed: `git:${commit.sha}`,
				},
				ctx,
			);
			result.events += store.add(events);
		}
	}, maxFilesPerCommit);

	await streamGit(
		[
			"-c",
			"core.quotepath=false",
			"log",
			`--since=${new Date(sinceMs).toISOString()}`,
			"--no-color",
			"--no-ext-diff",
			"-M",
			"--no-merges",
			"-p",
			"-U0",
			"--relative",
			`--format=${COMMIT_MARKER}%x09%H%x09%ct`,
			safeRef(opts.ref),
			"--",
			...pathspecsFor(ctx.extensions),
		],
		cwd,
		(line) => parser.push(line),
	);
	parser.end();
	result.skippedCommits = parser.skippedCommits;
	return result;
}

/** Updates remote refs. Slow and network-bound, so it is opt-in and time-limited. */
export function gitFetch(cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(gitBinary, ["fetch", "--quiet", "--no-tags"], { cwd, env: gitEnv(), timeout: 60_000 }, (err) => resolve(!err));
	});
}

/** Commit time of HEAD in ms, or 0 when there are no commits. */
export function headCommitTime(cwd: string, ref = "HEAD"): Promise<number> {
	return new Promise((resolve) => {
		execFile(gitBinary, ["log", "-1", "--format=%ct", safeRef(ref)], { cwd, env: gitEnv() }, (err, stdout) => {
			const n = Number(stdout.trim());
			resolve(err || !Number.isFinite(n) ? 0 : n * 1000);
		});
	});
}

export interface WorkingTreeChanges {
	/** Tracked files that differ from HEAD (staged or not). */
	changed: ParsedFile[];
	/** Files git does not track and does not ignore. */
	untracked: string[];
}

/**
 * Everything that differs from HEAD right now. When the repository is behind the vault
 * (for example `.git` is not synced between machines), this is how recent activity is found.
 */
export async function workingTreeChanges(cwd: string, extensions: string[], ref = "HEAD"): Promise<WorkingTreeChanges> {
	const specs = pathspecsFor(extensions);
	const changed: ParsedFile[] = [];
	const parser = new GitLogParser((c) => changed.push(...c.files.filter((f) => !f.deleted)), Number.MAX_SAFE_INTEGER);
	parser.push(`${COMMIT_MARKER}\tworktree\t0`);
	await streamGit(
		["-c", "core.quotepath=false", "diff", safeRef(ref), "--no-color", "--no-ext-diff", "-M", "-U0", "--relative", "--", ...specs],
		cwd,
		(line) => parser.push(line),
	);
	parser.end();

	// "Untracked" is judged against the index, which can be behind the ref we read history from.
	// Anything already in that ref's tree is covered by its commits.
	const inRef = new Set<string>();
	// ls-tree takes literal paths, not globs, so list everything and keep it all
	await streamGit(["-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", safeRef(ref)], cwd, (line) => {
		if (line) inRef.add(line);
	});
	const untracked: string[] = [];
	await streamGit(
		["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", ...specs],
		cwd,
		(line) => {
			if (line && !inRef.has(line)) untracked.push(line);
		},
	);
	return { changed, untracked };
}
