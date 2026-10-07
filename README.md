# Activity Timeline

A timeline of everything that happens in your vault, built from live edits and your git history.

Open it and see what you actually did today, this week or this year: which notes you created and edited, which tasks you closed or dropped, what you captured, and how busy each day was.

- **Event feed** grouped by day, with the first changed lines of each edit so you recognise the note without opening it.
- **Day / Week / Month / Year** views with previous and next navigation.
- **Filters** by type (notes, tasks, captures, canvas and snippets) and by folder.
- **Heatmap** of the last 10 weeks. Click a day to jump to it.
- **Counts by type** for the period you are looking at.
- **History from day one.** If your vault is a git repository, the plugin rebuilds past activity from commits, including edits made while Obsidian was closed or by other tools and devices.
- Click any card to open the note at the changed line. Cmd/Ctrl-click opens it in a split.

## What counts as what

| Type | How it is detected |
| --- | --- |
| Note created | A new Markdown file. |
| Note edited | Changed non-blank lines in a Markdown file. Edits of the same note within 30 minutes merge into one event. |
| Task completed | A checkbox changes from anything to `[x]`, or a new line appears already checked. |
| Task killed | A checkbox changes to `[-]`. |
| Capture | A new note whose path matches one of your capture rules (see below). |
| Canvas and snippets | Changes to `.canvas`, `.base` and `.css` files. Configurable. |

Moving a checked task to another place in the note is not counted as completing it.

## Capture rules

A capture is a new note that arrives from somewhere else: a web clipper, a transcript, an inbox. Add rules in **Settings → Activity Timeline → Captures**:

| Name | Path prefix | Icon |
| --- | --- | --- |
| Web clips | `Clippings/` | `bookmark` |
| Transcripts | `Projects/*/Transcripts/` | `mic` |

`*` matches one path segment. Icons are [Lucide](https://lucide.dev/icons/) names.

## How it records

- **Live:** the plugin watches vault events. Obsidian says a file changed but not what changed, so the plugin keeps a copy of your notes in memory (read once at startup, about the size of your notes, capped at 80 MB) and compares against it when a change settles. This is also how changes made by sync tools and scripts get an excerpt. If a note is not in memory, the last committed version is used when it is recent.
- **Git:** on start and every five minutes, new commits are read with `git log -p`. By default history comes from `HEAD`; set **History source** to `origin/main` (and turn on **Fetch before importing**) if this copy of the vault is not committed to locally but is backed up to a remote. Commits touching more than 300 files (bulk imports, mass renames) are skipped. Renames without content changes are ignored.
- When both sources describe the same edit, the live one wins and the git one is dropped.

Activity is stored in `events.jsonl` inside the plugin folder. It never leaves your machine. Add it to `.gitignore` if your vault is a repository and you auto-commit: it changes often.

## Limits

- Desktop only (the git import needs the `git` program).
- Without git, history starts the day you install the plugin.
- If the git history is behind the vault (for example `.git` is not synced between machines), files newer than the last commit are shown from their file dates, marked "from file dates", with one card per file.
- Edits made by sync tools or scripts look the same as your own. The timeline is statistics for the whole vault.

## Installation

From the community plugin browser, search for **Activity Timeline**.

Manual install: download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/activity-timeline/`, then enable the plugin.

## Development

```bash
npm install --legacy-peer-deps
npm run dev      # watch build
npm test
npm run build
```

## License

MIT
