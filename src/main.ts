import {
  type Editor,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  type TFile,
  type WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import { FRONTMATTER_FLAG, INK_FILE_SUFFIX, SCHEMA_VERSION, VIEW_TYPE_INK } from "./constants";
import { DEFAULT_SETTINGS, InkedMarkSettingTab, type InkedMarkSettings } from "./settings";
import { ICON_INK_NOTE, registerIcons } from "./icons";
import { emptyDocument } from "./model/document";
import { buildInkFile, encodeDocument } from "./model/serialize";
import { buildInlineBlock } from "./model/inline-block";
import type { RecognitionProvider } from "./recognition/provider";
import { createProviderRegistry, resolveProvider } from "./recognition/registry";
import { InkView } from "./view/ink-view";
import { registerInkEmbeds } from "./view/embed-processor";

export default class InkedMarkPlugin extends Plugin {
  override settings!: InkedMarkSettings;
  readonly providers = createProviderRegistry();

  /**
   * Ink files the user explicitly toggled to the markdown view. Without this,
   * `switchInkLeaves` (on layout-change) would immediately flip a toggled leaf
   * back to the ink view, making the toggle command a no-op.
   */
  private readonly markdownOverride = new Set<string>();

  /** The recognition provider selected in settings (manual in v1). */
  activeProvider(): RecognitionProvider {
    return resolveProvider(this.providers, this.settings.recognitionProviderId);
  }

  override async onload(): Promise<void> {
    await this.loadSettings();
    registerIcons();

    this.registerView(VIEW_TYPE_INK, (leaf) => new InkView(leaf, this));
    registerInkEmbeds(this);

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
        const view =
          this.app.workspace.getActiveViewOfType(InkView) ??
          this.app.workspace.getActiveViewOfType(MarkdownView);
        const eligible = !!view?.file && (view instanceof InkView || this.isInkFile(view.file));
        if (eligible && !checking && view) void this.toggleView(view.leaf);
        return eligible;
      },
    });

    this.addCommand({
      id: "insert-inline-handwriting",
      name: "Insert inline handwriting",
      editorCallback: (editor: Editor) => {
        const payload = encodeDocument(emptyDocument(this.settings.paperWidth));
        editor.replaceSelection(buildInlineBlock(payload));
      },
    });

    this.addCommand({
      id: "toggle-text-layer",
      name: "Toggle text layer panel",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) view.toggleTextPanel();
        return !!view;
      },
    });

    this.addCommand({
      id: "recognize-handwriting",
      name: "Recognize handwriting in this note",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) void view.recognize(this.activeProvider());
        return !!view;
      },
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

    this.addCommand({
      id: "zoom-in",
      name: "Zoom in",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) view.zoomIn();
        return !!view;
      },
    });

    this.addCommand({
      id: "zoom-out",
      name: "Zoom out",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(InkView);
        if (view && !checking) view.zoomOut();
        return !!view;
      },
    });

    this.addCommand({
      id: "toggle-input-debug-overlay",
      name: "Toggle input debug overlay",
      callback: () => void this.toggleDebugHud(),
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

  /**
   * One-time iPad notice: iPadOS Scribble intercepts fast Pencil strokes before
   * the web view sees them. We can't disable it from a plugin (it's a native
   * system feature), so we point the user at the setting. Shown once, on first
   * ink-note open on an iPad.
   */
  async maybeShowScribbleNotice(): Promise<void> {
    if (!Platform.isIosApp || !Platform.isTablet) return;
    if (this.settings.scribbleNoticeShown) return;
    this.settings.scribbleNoticeShown = true;
    await this.saveSettings();
    new Notice(
      "InkedMark tip: if handwriting drops strokes on iPad, turn off " +
        "Settings → Apple Pencil → Scribble. iPadOS intercepts fast Pencil " +
        "strokes before InkedMark can see them.",
      0,
    );
  }

  /** Turn the input debug overlay on/off everywhere (settings toggle + command). */
  async setDebugHud(enabled: boolean, notify = false): Promise<void> {
    this.settings.debugHud = enabled;
    await this.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_INK)) {
      if (leaf.view instanceof InkView) leaf.view.setDebug(enabled);
    }
    if (notify) new Notice(`InkedMark input debug overlay ${enabled ? "on" : "off"}`);
  }

  private async toggleDebugHud(): Promise<void> {
    await this.setDebugHud(!this.settings.debugHud, true);
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
      if (this.markdownOverride.has(view.file.path)) continue;
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
    const toMarkdown = leaf.view instanceof InkView;
    if (toMarkdown) this.markdownOverride.add(file.path);
    else this.markdownOverride.delete(file.path);
    await this.setLeafViewType(leaf, toMarkdown ? "markdown" : VIEW_TYPE_INK, file);
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
