import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ActivityTimelinePlugin from "./main";

function parseNumber(value: string, fallback: number, min: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n >= min ? Math.round(n) : fallback;
}

export class ActivityTimelineSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ActivityTimelinePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => void this.plugin.saveSettings();
		containerEl.empty();

		new Setting(containerEl).setName("Recording").setHeading();

		new Setting(containerEl)
			.setName("Keep notes in memory")
			.setDesc(
				"Reads notes at startup so changes made by sync tools or scripts can show what changed. Uses memory roughly equal to the size of your notes, up to 80 MB.",
			)
			.addToggle((t) =>
				t.setValue(s.preloadNotes).onChange((v) => {
					s.preloadNotes = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Group edits within")
			.setDesc("Seconds of quiet after the last keystroke before an edit is recorded.")
			.addText((t) =>
				t.setValue(String(s.groupSeconds)).onChange((v) => {
					s.groupSeconds = parseNumber(v, s.groupSeconds, 5);
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Merge edit sessions within")
			.setDesc("Minutes. Edits of the same note closer together than this show up as one event.")
			.addText((t) =>
				t.setValue(String(s.mergeMinutes)).onChange((v) => {
					s.mergeMinutes = parseNumber(v, s.mergeMinutes, 0);
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("One folder per line. Nothing inside is recorded.")
			.addTextArea((t) =>
				t.setValue(s.excludedFolders.join("\n")).onChange((v) => {
					s.excludedFolders = v.split("\n").map((x) => x.trim()).filter(Boolean);
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Canvas and snippet file types")
			.setDesc("Comma-separated extensions tracked besides notes. They appear under the canvas and snippets filter.")
			.addText((t) =>
				t.setValue(s.fileExtensions.join(", ")).onChange((v) => {
					s.fileExtensions = v
						.split(",")
						.map((x) => x.trim().replace(/^\./, "").toLowerCase())
						.filter(Boolean);
					save();
				}),
			);

		new Setting(containerEl).setName("Captures").setHeading();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "A new note whose path matches a rule is shown as a capture instead of a created note. An asterisk matches one path segment.",
		});

		s.captureRules.forEach((rule, i) => {
			new Setting(containerEl)
				.setName(`Rule ${i + 1}`)
				.addText((t) =>
					t
						.setPlaceholder("Name")
						.setValue(rule.name)
						.onChange((v) => {
							rule.name = v;
							save();
						}),
				)
				.addText((t) =>
					t
						.setPlaceholder("Path prefix, e.g. Clippings/")
						.setValue(rule.pattern)
						.onChange((v) => {
							rule.pattern = v;
							save();
						}),
				)
				.addText((t) =>
					t
						.setPlaceholder("Icon")
						.setValue(rule.icon)
						.onChange((v) => {
							rule.icon = v.trim() || "bookmark";
							save();
						}),
				)
				.addExtraButton((b) =>
					b
						.setIcon("trash")
						.setTooltip("Remove rule")
						.onClick(() => {
							s.captureRules.splice(i, 1);
							save();
							this.display();
						}),
				);
		});

		new Setting(containerEl).addButton((b) =>
			b.setButtonText("Add rule").onClick(() => {
				s.captureRules.push({ name: "", pattern: "", icon: "bookmark" });
				save();
				this.display();
			}),
		);

		new Setting(containerEl).setName("Git history").setHeading();

		new Setting(containerEl)
			.setName("Import history from Git")
			.setDesc(
				"If the vault is a Git repository, past activity is rebuilt from its commits and new commits are picked up while Obsidian is open. This also covers edits made while Obsidian was closed.",
			)
			.addToggle((t) =>
				t.setValue(s.gitEnabled).onChange((v) => {
					s.gitEnabled = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("History source")
			.setDesc(
				"Branch or ref to read history from. Use origin/main if this copy of the vault is not committed to locally but is backed up to a remote.",
			)
			.addText((t) =>
				t
					.setPlaceholder("HEAD")
					.setValue(s.gitRef)
					.onChange((v) => {
						s.gitRef = v.trim() || "HEAD";
						s.gitImportedUntil = 0;
						save();
					}),
			);

		new Setting(containerEl)
			.setName("Fetch before importing")
			.setDesc("Downloads new commits from the remote first. Needs network access and working git credentials.")
			.addToggle((t) =>
				t.setValue(s.gitFetch).onChange((v) => {
					s.gitFetch = v;
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Backfill period")
			.setDesc("Days of history to import on the first run.")
			.addText((t) =>
				t.setValue(String(s.gitBackfillDays)).onChange((v) => {
					s.gitBackfillDays = parseNumber(v, s.gitBackfillDays, 1);
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Skip commits touching more than")
			.setDesc("Files per commit. Bulk imports and mass renames would otherwise flood the timeline.")
			.addText((t) =>
				t.setValue(String(s.gitMaxFilesPerCommit)).onChange((v) => {
					s.gitMaxFilesPerCommit = parseNumber(v, s.gitMaxFilesPerCommit, 1);
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Git executable")
			.setDesc("Path to the Git program. Change it only if Obsidian cannot find Git.")
			.addText((t) =>
				t.setValue(s.gitPath).onChange((v) => {
					s.gitPath = v.trim() || "git";
					save();
				}),
			);

		new Setting(containerEl)
			.setName("Import now")
			.setDesc("Fetch commits made since the last import.")
			.addButton((b) => b.setButtonText("Import").onClick(() => void this.plugin.importGit(true)));

		new Setting(containerEl).setName("Display").setHeading();

		new Setting(containerEl).setName("First day of the week").addDropdown((d) =>
			d
				.addOption("monday", "Monday")
				.addOption("sunday", "Sunday")
				.setValue(s.weekStartsOnMonday ? "monday" : "sunday")
				.onChange((v) => {
					s.weekStartsOnMonday = v === "monday";
					save();
				}),
		);

		new Setting(containerEl).setName("Data").setHeading();

		new Setting(containerEl)
			.setName("Clear recorded activity")
			.setDesc(`${this.plugin.store.size} events are stored. Git history can be imported again afterwards.`)
			.addButton((b) =>
				b
					.setButtonText("Clear")
					.setWarning()
					.onClick(async () => {
						if (b.buttonEl.textContent !== "Click again to confirm") {
							b.setButtonText("Click again to confirm");
							return;
						}
						await this.plugin.clearLog();
						new Notice("Activity log cleared");
						this.display();
					}),
			);
	}
}
