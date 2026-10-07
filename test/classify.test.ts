import { describe, expect, it } from "vitest";
import { buildEvents, buildExcerpt, cleanInline, matchCaptureRule, parseTask } from "../src/classify";
import { lineDiff } from "../src/linediff";

const ctx = {
	rules: [
		{ name: "Raindrop", pattern: "Raindrop/", icon: "bookmark" },
		{ name: "Transcript", pattern: "Projects/*/Transcripts/", icon: "mic" },
	],
	extensions: ["canvas", "css"],
	excluded: [".trash"],
};
const mkChange = (path: string, oldT: string | null, newT: string, created = false) => ({
	path,
	ts: 1_000,
	created,
	diff: lineDiff(created ? null : oldT, newT),
	origin: "live" as const,
	idSeed: "t",
});

describe("tasks", () => {
	it("detects completion by checkbox flip", () => {
		const ev = buildEvents(mkChange("Tasks/a.md", "- [ ] Write the report\n- [ ] Other\n", "- [x] Write the report\n- [ ] Other\n"), ctx);
		expect(ev.map((e) => e.kind)).toEqual(["task-completed"]);
		expect(ev[0].title).toBe("Write the report");
		expect(ev[0].line).toBe(1);
	});
	it("detects killed tasks with [-]", () => {
		const ev = buildEvents(mkChange("Tasks/a.md", "- [ ] Drop me\n", "- [-] Drop me\n"), ctx);
		expect(ev.map((e) => e.kind)).toEqual(["task-killed"]);
	});
	it("matches when text is appended on completion", () => {
		const ev = buildEvents(
			mkChange(
				"Tasks/a.md",
				"- [ ] 🩺 **Записаться к неврологу** `📅 2026-08-15` ⏱ ~15м\n",
				"- [x] 🩺 **Записаться к неврологу** — ✅ записан ✓ 2026-08-24 `📅 2026-08-15` ⏱ ~15м\n",
			),
			ctx,
		);
		expect(ev.map((e) => e.kind)).toEqual(["task-completed"]);
	});
	it("ignores a done task that was only moved", () => {
		const ev = buildEvents(
			mkChange("Tasks/a.md", "- [x] Same task here, moved\n\nfoo\n", "foo\n\n- [x] Same task here, moved\n"),
			ctx,
		);
		expect(ev.some((e) => e.kind === "task-completed")).toBe(false);
	});
	it("counts a task added already done", () => {
		const ev = buildEvents(mkChange("Tasks/a.md", "a\n", "a\n- [x] Brand new and done\n"), ctx);
		expect(ev.map((e) => e.kind)).toEqual(["task-completed"]);
	});
	it("a new open task is a plain edit", () => {
		const ev = buildEvents(mkChange("Tasks/a.md", "a\n", "a\n- [ ] Brand new open task\n"), ctx);
		expect(ev.map((e) => e.kind)).toEqual(["note-edited"]);
	});
	it("emits both task and note events when prose also changed", () => {
		const ev = buildEvents(mkChange("Tasks/a.md", "intro\n- [ ] Do the thing now\n", "intro changed\n- [x] Do the thing now\n"), ctx);
		expect(ev.map((e) => e.kind).sort()).toEqual(["note-edited", "task-completed"]);
	});
	it("parses numbered and bullet tasks", () => {
		expect(parseTask("1. [x] foo")?.status).toBe("x");
		expect(parseTask("  * [ ] foo")?.status).toBe(" ");
		expect(parseTask("- not a task")).toBeNull();
	});
});

describe("notes", () => {
	it("created note with a matching rule is a capture", () => {
		const ev = buildEvents(mkChange("Raindrop/Cool page.md", null, "---\ntitle: x\n---\nHighlighted **text** here\n", true), ctx);
		expect(ev[0].kind).toBe("capture");
		expect(ev[0].source).toBe("Raindrop");
		expect(ev[0].excerpt).toEqual(["Highlighted text here"]);
	});
	it("wildcard rule", () => {
		expect(matchCaptureRule("Projects/Tablo/Transcripts/a.md", ctx.rules)?.name).toBe("Transcript");
		expect(matchCaptureRule("Projects/Tablo/Other/a.md", ctx.rules)).toBeNull();
	});
	it("created note otherwise", () => {
		const ev = buildEvents(mkChange("Knowledge/x.md", null, "# Title\nbody\n", true), ctx);
		expect(ev[0].kind).toBe("note-created");
		expect(ev[0].excerpt).toEqual(["Title", "body"]);
	});
	it("edit gives changes count and excerpt, skipping frontmatter-like noise", () => {
		const ev = buildEvents(mkChange("Knowledge/x.md", "a\nb\nc\n", "a\nB changed\nc\nnew line\n"), ctx);
		expect(ev).toHaveLength(1);
		expect(ev[0].kind).toBe("note-edited");
		expect(ev[0].changes).toBe(3);
		expect(ev[0].excerpt).toEqual(["B changed", "new line"]);
		expect(ev[0].line).toBe(2);
	});
	it("whitespace-only edits produce nothing", () => {
		expect(buildEvents(mkChange("a.md", "a\n\nb\n", "a\n\n\nb\n"), ctx)).toEqual([]);
	});
	it("unknown baseline still logs an edit", () => {
		const ev = buildEvents({ path: "a.md", ts: 1, created: false, diff: null, origin: "live", idSeed: "x" }, ctx);
		expect(ev.map((e) => e.kind)).toEqual(["note-edited"]);
	});
	it("tracks canvas, ignores unknown extensions and excluded folders", () => {
		expect(buildEvents(mkChange("a.canvas", "{}", '{"a":1}'), ctx)[0].kind).toBe("file-changed");
		expect(buildEvents(mkChange("a.png", "x", "y"), ctx)).toEqual([]);
		expect(buildEvents(mkChange(".trash/a.md", "x", "y"), ctx)).toEqual([]);
	});
	it("excerpt skips yaml keys and code fences", () => {
		expect(buildExcerpt([{ line: 3, text: "status: done" }, { line: 4, text: "```js" }, { line: 5, text: "Real text" }])).toEqual(["Real text"]);
	});
	it("cleanInline strips markdown", () => {
		expect(cleanInline("- [ ] See [[Folder/Note|the note]] and [link](http://x) **bold**")).toBe("See the note and link bold");
	});
});
