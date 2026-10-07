import { diffLines } from "diff";

export interface DiffLine {
	/** 1-based line number in the new text (for removed lines: position where they were removed). */
	line: number;
	text: string;
}

export interface LineDiff {
	added: DiffLine[];
	removed: DiffLine[];
}

function splitLines(value: string): string[] {
	const lines = value.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines.map((l) => l.replace(/\r$/, ""));
}

function withTrailingNewline(text: string): string {
	return text.endsWith("\n") ? text : text + "\n";
}

/** Line-level diff. `oldText === null` means the file did not exist before. */
export function lineDiff(oldText: string | null, newText: string): LineDiff {
	const added: DiffLine[] = [];
	const removed: DiffLine[] = [];

	if (oldText === null) {
		splitLines(newText).forEach((text, i) => added.push({ line: i + 1, text }));
		return { added, removed };
	}

	let newLine = 1;
	for (const part of diffLines(withTrailingNewline(oldText), withTrailingNewline(newText))) {
		const lines = splitLines(part.value);
		if (part.added) {
			for (const text of lines) added.push({ line: newLine++, text });
		} else if (part.removed) {
			for (const text of lines) removed.push({ line: newLine, text });
		} else {
			newLine += lines.length;
		}
	}
	return { added, removed };
}
