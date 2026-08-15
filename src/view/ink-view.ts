/**
 * `TextFileView` for `*.ink.md`: toolbar + drawing surface + text-layer panel.
 *
 * Layout (all inside `contentEl`):
 *
 *   .inkedmark-view
 *     .inkedmark-toolbar          (built by Toolbar)
 *     .inkedmark-surface          (built by InkSurface: canvases + input)
 *     .inkedmark-textpanel        (searchable markdown body)
 *
 * The view owns file persistence, data-safety protection, the text layer and
 * recognition; all drawing/erasing/selection/zoom lives in `InkSurface`, which
 * is shared with the inline-block editor.
 */

import { Notice, TextFileView, type WorkspaceLeaf } from "obsidian";
import {
  AUTO_RECOGNIZE_IDLE_MS,
  BLOCK_LABEL,
  BUILD_ID,
  PALETTE,
  SIZES,
  VIEW_TYPE_INK,
} from "../constants";
import {
  type InkDocument,
  emptyDocument,
  primaryRegion,
  strokeCount,
  strokesContentHash,
} from "../model/document";
import { buildInkFile, parseInkFile, splitFrontmatter } from "../model/serialize";
import type { RecognitionProvider } from "../recognition/provider";
import { MANUAL_PROVIDER_ID } from "../recognition/manual";
import { providerLabel } from "../recognition/registry";
import { readTextSection, writeTextSection } from "../recognition/text-layer";
import { ICON_INK_PEN } from "../icons";
import { InkSurface } from "./ink-surface";
import { Toolbar, type ToolbarState } from "./toolbar";
import type InkedMarkPlugin from "../main";

export class InkView extends TextFileView {
  private doc: InkDocument;
  private bodyText = "";

  private built = false;
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private readonly toolState: ToolbarState;
  private readonly buildLabel: string;

  // Text-layer panel (searchable markdown body — prose only; frontmatter hidden).
  private textPanelEl: HTMLElement | null = null;
  private textArea: HTMLTextAreaElement | null = null;
  private showTextPanel = false;
  private frontmatter = "";

  // Auto-recognition idle timer (opt-in setting).
  private autoRecognizeTimer = 0;

  /** Original file bytes when the last load was suspect; saves echo these. */
  private protectedRaw: string | null = null;

  // Diagnostic HUD state (toggled via command / settings).
  private debug: boolean;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: InkedMarkPlugin,
  ) {
    super(leaf);
    this.buildLabel = `v${plugin.manifest.version} · ${BUILD_ID}`;
    this.debug = plugin.settings.debugHud;
    this.doc = emptyDocument(plugin.settings.paperWidth);
    this.toolState = {
      tool: plugin.settings.defaultTool,
      color: plugin.settings.defaultColor,
      size: plugin.settings.defaultSize,
      pressureEnabled: plugin.settings.pressureEnabled,
    };
  }

  getViewType(): string {
    return VIEW_TYPE_INK;
  }

  override getIcon(): string {
    return ICON_INK_PEN;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Ink note";
  }

  // --- TextFileView persistence ---------------------------------------------

  getViewData(): string {
    // Data-safety: when the last load looked wrong (an empty read of a
    // non-empty file, or a data block we couldn't decode), never rebuild the
    // file - echo the original bytes back so a save cannot wipe ink we failed
    // to parse. iCloud "dataless" placeholders and partial syncs are the
    // realistic triggers for both cases.
    if (this.protectedRaw !== null) return this.protectedRaw;
    return buildInkFile(this.bodyText, this.doc);
  }

  setViewData(data: string, _clear: boolean): void {
    const parsed = parseInkFile(data, this.plugin.settings.paperWidth);
    const emptyReadOfRealFile = data.trim().length === 0 && (this.file?.stat.size ?? 0) > 0;
    const unreadableBlock = parsed.doc === null && data.includes(`%%${BLOCK_LABEL}`);
    this.protectedRaw = emptyReadOfRealFile || unreadableBlock ? data : null;
    if (this.protectedRaw !== null) {
      new Notice(
        "InkedMark: couldn't read this note's ink data (incomplete sync?). " +
          "The note is protected until it loads cleanly - your ink on disk is safe. " +
          "Reopen it once the file has fully synced.",
        10000,
      );
    }
    this.bodyText = parsed.body;
    this.doc = parsed.doc ?? emptyDocument(this.plugin.settings.paperWidth);
    this.syncPanelFromBody();
    if (this.built) {
      this.surface?.setDocument(this.doc);
      this.updateStatus();
    }
  }

  /** Load the panel with the body's prose, keeping frontmatter aside. */
  private syncPanelFromBody(): void {
    const { frontmatter, prose } = splitFrontmatter(this.bodyText);
    this.frontmatter = frontmatter;
    if (this.textArea) this.textArea.value = prose;
  }

  clear(): void {
    this.bodyText = "";
    this.doc = emptyDocument(this.plugin.settings.paperWidth);
    if (this.built) this.surface?.setDocument(this.doc);
  }

  // --- Lifecycle ------------------------------------------------------------

  override async onOpen(): Promise<void> {
    this.buildDom();
    this.built = true;
    void this.plugin.maybeShowScribbleNotice();
  }

  override async onClose(): Promise<void> {
    window.clearTimeout(this.autoRecognizeTimer);
    this.surface?.destroy();
    this.surface = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.contentEl.empty();
    this.built = false;
  }

  override onResize(): void {
    this.surface?.layout();
  }

  /** Reset zoom to 1 and scroll back to the top ("fit / reset"). */
  resetView(): void {
    this.surface?.resetView();
  }

  zoomIn(): void {
    this.surface?.zoomIn();
  }

  zoomOut(): void {
    this.surface?.zoomOut();
  }

  /** Enable/disable the on-screen pointer-event overlay. */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
    this.surface?.setDebug(enabled);
    this.updateStatus();
  }

  /**
   * Run a recognition provider over this note's strokes and merge any recognized
   * text into the body's managed text section. Skipped when the ink hasn't
   * changed since the last run (content hash), so repeated/automatic triggers
   * don't burn API calls or churn good text. An empty page clears the managed
   * section (the user's own prose is untouched). `auto` mutes the chatty notices.
   */
  async recognize(provider: RecognitionProvider, auto = false): Promise<void> {
    if (this.protectedRaw !== null) {
      if (!auto) {
        new Notice("InkedMark: this note is protected until its ink data loads cleanly.");
      }
      return;
    }
    const strokes = primaryRegion(this.doc).strokes;
    const hash = strokesContentHash(this.doc);

    if (strokes.length === 0) {
      if (readTextSection(this.bodyText) !== null) {
        this.bodyText = writeTextSection(this.bodyText, "");
        this.syncPanelFromBody();
        this.doc.recognizedHash = hash;
        this.requestSave();
        if (!auto) new Notice("InkedMark: page is empty — cleared the transcription.");
      } else if (!auto) {
        new Notice("InkedMark: nothing to recognize yet.");
      }
      return;
    }

    if (provider.requiresNetwork && this.doc.recognizedHash === hash) {
      if (!auto) new Notice("InkedMark: transcription is already up to date.");
      return;
    }

    const progress =
      provider.id === MANUAL_PROVIDER_ID
        ? null
        : new Notice("InkedMark: recognizing handwriting…", 0);
    try {
      const result = await provider.recognize({
        strokes,
        onProgress: (message) => progress?.setMessage(`InkedMark: ${message}`),
      });
      if (result.text.trim()) {
        this.bodyText = writeTextSection(this.bodyText, result.text);
        this.syncPanelFromBody();
        this.doc.recognizedHash = hash;
        if (!auto && !this.showTextPanel) this.toggleTextPanel();
        this.requestSave();
        new Notice("InkedMark: transcription added to the text layer — review and edit it.");
      } else if (!auto) {
        new Notice("InkedMark: manual transcription — type it in the text-layer panel.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`InkedMark recognition failed: ${message}`, 8000);
    } finally {
      progress?.hide();
    }
  }

  /**
   * Debounced background recognition: fires once the ink has been idle for a
   * while. Opt-in, and never prompts — it only runs for a network provider the
   * user has already consented to. The content-hash check in `recognize` makes
   * redundant fires free.
   */
  private scheduleAutoRecognize(): void {
    window.clearTimeout(this.autoRecognizeTimer);
    if (!this.plugin.settings.autoRecognize) return;
    if (!this.plugin.settings.cloudConsentGiven) return;
    if (!this.plugin.activeProvider().requiresNetwork) return;
    this.autoRecognizeTimer = window.setTimeout(() => {
      void this.plugin.runRecognition(this, true);
    }, AUTO_RECOGNIZE_IDLE_MS);
  }

  /** Show/hide the text-layer panel (searchable markdown body). */
  toggleTextPanel(): void {
    this.showTextPanel = !this.showTextPanel;
    if (!this.textPanelEl || !this.textArea) return;
    this.textPanelEl.style.display = this.showTextPanel ? "" : "none";
    if (this.showTextPanel) {
      this.syncPanelFromBody();
      this.textArea.focus();
    }
    this.surface?.layout();
  }

  // --- DOM construction -----------------------------------------------------

  private buildDom(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("inkedmark-view");

    // Factory-default ink is near-black; on a dark theme that is invisible, so
    // start with white when the user hasn't chosen a custom default color.
    const dark = activeDocument.body.classList.contains("theme-dark");
    if (this.toolState.color === PALETTE[0] && dark) {
      this.toolState.color = PALETTE[1];
    }

    const palette = [...PALETTE, ...this.plugin.settings.customColors];
    this.toolbar = new Toolbar(root, palette, SIZES, this.toolState, {
      onToolChange: (tool) => this.surface?.setTool(tool),
      onColorChange: () => undefined,
      onSizeChange: () => undefined,
      onPressureToggle: () => undefined,
      onUndo: () => this.surface?.undo(),
      onRedo: () => this.surface?.redo(),
      onClear: () => this.clearStrokes(),
      onZoomIn: () => this.zoomIn(),
      onZoomOut: () => this.zoomOut(),
      onZoomReset: () => this.resetView(),
      onToggleText: () => this.toggleTextPanel(),
      onRecognize: () => void this.plugin.runRecognition(this),
    });

    this.surface = new InkSurface(
      root,
      this.doc,
      this.toolState,
      {
        paperWidth: this.plugin.settings.paperWidth,
        desynchronizedCanvas: this.plugin.settings.desynchronizedCanvas,
        highlighterAlpha: this.plugin.settings.highlighterAlpha,
        darkTheme: dark,
        debug: this.debug,
      },
      {
        onChange: () => {
          this.scheduleAutoRecognize();
          this.requestSave();
        },
        onStatus: () => this.updateStatus(),
        isLocked: () => {
          if (this.protectedRaw === null) return false;
          new Notice("InkedMark: this note is protected until its ink data loads cleanly.");
          return true;
        },
        onToolChange: () => this.toolbar?.setState(this.toolState),
      },
    );

    // Text-layer panel: the searchable markdown body (transcription, links, tags).
    this.textPanelEl = root.createDiv({ cls: "inkedmark-textpanel" });
    this.textPanelEl.createDiv({
      cls: "inkedmark-textpanel-label",
      text: "Text layer — searchable transcription, [[links]], #tags",
    });
    this.textArea = this.textPanelEl.createEl("textarea", { cls: "inkedmark-textpanel-input" });
    this.textArea.placeholder = "Transcription, key points, [[links]], #tags…";
    this.syncPanelFromBody();
    this.textPanelEl.style.display = this.showTextPanel ? "" : "none";
    this.registerDomEvent(this.textArea, "input", () => {
      if (!this.textArea) return;
      // The panel edits prose only; frontmatter is preserved untouched.
      this.bodyText = this.frontmatter + this.textArea.value;
      this.requestSave();
    });

    // Repaint when the theme flips so monochrome ink re-adapts to the paper.
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.surface?.setDarkTheme(activeDocument.body.classList.contains("theme-dark"));
      }),
    );
    this.registerDomEvent(this.contentEl, "keydown", (e) => {
      this.surface?.handleKeyDown(e);
    });

    this.updateStatus();
  }

  /** Toolbar readout: build id + live committed-stroke count + zoom (a testing aid). */
  private updateStatus(): void {
    const engine = providerLabel(this.plugin.settings.recognitionProviderId);
    this.toolbar?.setRecognizeLabel(`Recognize handwriting — ${engine}`);
    const debugSuffix = this.debug ? ` · ${engine}` : "";
    const guard = this.protectedRaw !== null ? " · ⚠ protected (sync)" : "";
    const zoom = Math.round((this.surface?.zoom ?? 1) * 100);
    this.toolbar?.setStatus(
      `${this.buildLabel} · ${strokeCount(this.doc)} strokes · ${zoom}%` + debugSuffix + guard,
    );
  }

  private clearStrokes(): void {
    if (!this.surface?.clearStrokes()) return;
    // The auto-transcription mirrors the ink; clearing the page clears it too.
    // (User prose outside the managed section is untouched. Undo restores the
    // strokes but not the transcription - re-run recognition to regenerate it.)
    if (readTextSection(this.bodyText) !== null) {
      this.bodyText = writeTextSection(this.bodyText, "");
      this.syncPanelFromBody();
    }
    this.doc.recognizedHash = undefined;
    this.requestSave();
  }
}
