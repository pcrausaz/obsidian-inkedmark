import {
  MarkdownView,
  Notice,
  Plugin,
  type TFile,
  type WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import { FRONTMATTER_FLAG, INK_FILE_SUFFIX, SCHEMA_VERSION, VIEW_TYPE_INK } from "./constants";
import { DEFAULT_SETTINGS, InkedMarkSettingTab, type InkedMarkSettings } from "./settings";
import { ICON_INK_NOTE, registerIcons } from "./icons";
import { emptyDocument } from "./model/document";
import { buildInkFile } from "./model/serialize";
import { InkView } from "./view/ink-view";

export default class InkedMarkPlugin extends Plugin {
  override settings!: InkedMarkSettings;

  override async onload(): Promise<void> {
    await this.loadSettings();
    registerIcons();

    this.registerView(VIEW_TYPE_INK, (leaf) => new InkView(leaf, this));

    this.addRibbonIcon(ICON_INK_NOTE, "Create handwriting note", () => {
      void this.createInkNote();
    });

    this.addCommand({
      id: "create-handwriting-note",
      name: "Create handwriting note",
      callback: () => void this.createInkNote(),
    });

    this.addCommand({
      id: "toggle-canvas-markdown-view",
      name: "Toggle canvas / markdown view",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        const file = this.activeFile(leaf);
        const eligible = !!leaf && !!file && (this.isInkFile(file) || leaf.view instanceof InkView);
        if (eligible && !checking && leaf) void this.toggleView(leaf);
        return eligible;
      },
    });

    this.addCommand({
      id: "recognize-handwriting",
      name: "Recognize handwriting in this note",
      callback: () => new Notice("InkedMark: handwriting recognition arrives in a later release."),
    });

    this.addCommand({
      id: "fit-reset-view",
      name: "Fit / reset view",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) view.resetView();
        return !!view;
      },
    });

    // Swap the markdown view for the ink view whenever an ink file is shown.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.switchInkLeaves()));
    this.app.workspace.onLayoutReady(() => this.switchInkLeaves());

    this.addSettingTab(new InkedMarkSettingTab(this.app, this));
  }

  override onunload(): void {
    // Leaves of VIEW_TYPE_INK are detached automatically by Obsidian.
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // --- Ink-file detection & view switching ----------------------------------

  isInkFile(file: TFile): boolean {
    if (file.extension !== "md") return false;
    if (file.name.endsWith(INK_FILE_SUFFIX)) return true;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return !!frontmatter && frontmatter[FRONTMATTER_FLAG] === true;
  }

  private activeFile(leaf: WorkspaceLeaf | null): TFile | null {
    const view = leaf?.view;
    if (view instanceof MarkdownView || view instanceof InkView) return view.file;
    return null;
  }

  private switchInkLeaves(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) continue;
      if (!this.isInkFile(view.file)) continue;
      void this.setLeafViewType(leaf, VIEW_TYPE_INK, view.file);
    }
  }

  private async setLeafViewType(leaf: WorkspaceLeaf, type: string, file: TFile): Promise<void> {
    const existing = leaf.getViewState();
    await leaf.setViewState({
      ...existing,
      type,
      state: { ...existing.state, file: file.path, mode: "source" },
      active: existing.active,
    });
  }

  private async toggleView(leaf: WorkspaceLeaf): Promise<void> {
    const file = this.activeFile(leaf);
    if (!file) return;
    const target = leaf.view instanceof InkView ? "markdown" : VIEW_TYPE_INK;
    await this.setLeafViewType(leaf, target, file);
  }

  // --- New note -------------------------------------------------------------

  private async createInkNote(): Promise<void> {
    const path = await this.uniqueInkPath();
    const basename = path.slice(path.lastIndexOf("/") + 1, -INK_FILE_SUFFIX.length);
    const created = new Date().toISOString();
    const body =
      `---\n` +
      `${FRONTMATTER_FLAG}: true\n` +
      `inkedmark-version: ${SCHEMA_VERSION}\n` +
      `created: ${created}\n` +
      `modified: ${created}\n` +
      `---\n\n` +
      `# ${basename}\n`;
    const content = buildInkFile(body, emptyDocument(this.settings.paperWidth));

    const file = await this.app.vault.create(path, content);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_INK, state: { file: file.path }, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async uniqueInkPath(): Promise<string> {
    const activeFile = this.app.workspace.getActiveFile();
    const folder =
      activeFile?.parent?.path && activeFile.parent.path !== "/" ? activeFile.parent.path : "";
    const base = "Handwriting note";
    for (let i = 0; ; i++) {
      const name = i === 0 ? `${base}${INK_FILE_SUFFIX}` : `${base} ${i}${INK_FILE_SUFFIX}`;
      const path = normalizePath(folder ? `${folder}/${name}` : name);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
    }
  }
}
