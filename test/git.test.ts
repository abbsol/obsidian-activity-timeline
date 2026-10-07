import { describe, expect, it } from "vitest";
import { GitLogParser, ParsedCommit } from "../src/git";

const sample = `@@@C\tabc123\t1790000000

diff --git a/Tasks/a.md b/Tasks/a.md
index 111..222 100644
--- a/Tasks/a.md
+++ b/Tasks/a.md
@@ -3 +3 @@
-- [ ] Do thing
+- [x] Do thing
@@ -10,0 +11,2 @@
+new line one
+new line two
diff --git a/Raindrop/New page.md b/Raindrop/New page.md
new file mode 100644
index 000..333
--- /dev/null
+++ b/Raindrop/New page.md\t
@@ -0,0 +1,2 @@
+# Hello
+world
diff --git a/old.md b/old.md
deleted file mode 100644
index 444..000
--- a/old.md
+++ /dev/null
@@ -1 +0,0 @@
-gone
@@@C\tdef456\t1790000100

diff --git a/b.md b/b.md
--- a/b.md
+++ b/b.md
@@ -1 +1 @@
-x
+y
`;

describe("GitLogParser", () => {
	it("parses commits, files, hunks, created and deleted", () => {
		const commits: ParsedCommit[] = [];
		const p = new GitLogParser((c) => commits.push(c), 100);
		sample.split("\n").forEach((l) => p.push(l));
		p.end();
		expect(commits).toHaveLength(2);
		const [c1, c2] = commits;
		expect(c1.sha).toBe("abc123");
		expect(c1.ts).toBe(1790000000_000);
		expect(c1.files.map((f) => f.path)).toEqual(["Tasks/a.md", "Raindrop/New page.md", "old.md"]);
		expect(c1.files[0].added).toEqual([
			{ line: 3, text: "- [x] Do thing" },
			{ line: 11, text: "new line one" },
			{ line: 12, text: "new line two" },
		]);
		expect(c1.files[0].removed).toEqual([{ line: 3, text: "- [ ] Do thing" }]);
		expect(c1.files[1].created).toBe(true);
		expect(c1.files[2].deleted).toBe(true);
		expect(c2.files[0].path).toBe("b.md");
	});
	it("skips commits that touch too many files", () => {
		const commits: ParsedCommit[] = [];
		const p = new GitLogParser((c) => commits.push(c), 1);
		sample.split("\n").forEach((l) => p.push(l));
		p.end();
		expect(commits.map((c) => c.sha)).toEqual(["def456"]);
		expect(p.skippedCommits).toBe(1);
	});
});
