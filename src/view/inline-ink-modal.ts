/**
 * Editor for an inline ```inkedmark``` block: a modal hosting the shared
 * toolbar + `InkSurface`. The host note's reading view / Live Preview can't
 * take pen input in place (the block re-renders on every file change and the
 * page owns scrolling), so editing happens here and the strokes are written
 * back into the fenced block when the modal closes.
 *
 * Closing (Done, ✕, Escape) saves when the drawing changed; "Discard" throws
 * the session's changes away.
 */

import { type App, Modal, Platform } from "obsidian";
import { PALETTE, SIZES } from "../constants";
import type { InkDocument } from "../model/document";
import type { InkedMarkSettings } from "../settings";
import { InkSurface } from "./ink-surface";
import { Toolbar, type ToolbarState } from "./toolbar";

export class InlineInkModal extends Modal {
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private dirty = false;
  private discarded = false;
  private readonly toolState: ToolbarState;

  /**
   * @param inkDoc document to edit (mutated in place; `doc` is taken by Modal)
   * @param onSave called on close when the drawing changed and wasn't discarded
   */
  constructor(
    app: App,
    private readonly settings: InkedMarkSettings,
    private readonly inkDoc: InkDocument,
    private readonly onSave: (doc: InkDocument) => void,
  ) {
    super(app);
    this.toolState = {
      tool: settings.defaultTool === "select" ? "pen" : settings.defaultTool,
      color: settings.defaultColor,
      size: settings.defaultSize,
      pressureEnabled: settings.pressureEnabled,
    };
  }

  override onOpen(): void {
    this.modalEl.addClass("inkedmark-inline-modal");
    this.titleEl.setText("Inline handwriting");
    const root = this.contentEl;
    root.empty();
    root.addClass("inkedmark-inline-editor");

    const dark = activeDocument.body.classList.contains("theme-dark");
    if (this.toolState.color === PALETTE[0] && dark) this.toolState.color = PALETTE[1];

    const palette = [...PALETTE, ...this.settings.customColors];
    this.toolbar = new Toolbar(
      root,
      palette,
      SIZES,
      this.toolState,
      {
        onToolChange: (tool) => this.surface?.setTool(tool),
        onColorChange: () => undefined,
        onSizeChange: () => undefined,
        onPressureToggle: () => undefined,
        onUndo: () => this.surface?.undo(),
        onRedo: () => this.surface?.redo(),
        onClear: () => this.surface?.clearStrokes(),
        onZoomIn: () => this.surface?.zoomIn(),
        onZoomOut: () => this.surface?.zoomOut(),
        onZoomReset: () => this.surface?.resetView(),
        onToggleText: () => undefined,
        onRecognize: () => undefined,
      },
      { textTools: false },
    );

    this.surface = new InkSurface(
      root,
      this.inkDoc,
      this.toolState,
      {
        paperWidth: this.settings.paperWidth,
        desynchronizedCanvas: this.settings.desynchronizedCanvas,
        highlighterAlpha: this.settings.highlighterAlpha,
        darkTheme: dark,
        debug: false,
      },
      {
        onChange: () => {
          this.dirty = true;
        },
        onStatus: () => this.updateStatus(),
        onToolChange: () => this.toolbar?.setState(this.toolState),
      },
    );

    const footer = root.createDiv({ cls: "inkedmark-inline-footer" });
    const hint = footer.createSpan({ cls: "inkedmark-inline-hint" });
    hint.setText(
      Platform.isMobile
        ? "Draw with the Pencil or a finger; strokes are saved into the note when you close."
        : "Strokes are saved into the note when you close. Cmd/Ctrl+Z undoes.",
    );
    const discard = footer.createEl("button", { text: "Discard changes" });
    discard.addEventListener("click", () => {
      this.discarded = true;
      this.close();
    });
    const done = footer.createEl("button", { text: "Done", cls: "mod-cta" });
    done.addEventListener("click", () => this.close());

    // Mod+Z / Mod+Shift+Z go through the modal's keymap scope so they win over
    // any global hotkey; unmodified keys (tool letters, Delete) are plain DOM
    // events on the modal — skip modified ones there to avoid double handling.
    this.scope.register(["Mod"], "z", (e) => {
      this.surface?.handleKeyDown(e);
      return false;
    });
    this.scope.register(["Mod", "Shift"], "z", (e) => {
      this.surface?.handleKeyDown(e);
      return false;
    });
    this.modalEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.metaKey || e.ctrlKey) return;
      this.surface?.handleKeyDown(e);
    });
    this.updateStatus();
  }

  private updateStatus(): void {
    const n = this.surface?.strokeCount() ?? 0;
    const zoom = Math.round((this.surface?.zoom ?? 1) * 100);
    this.toolbar?.setStatus(`${n} strokes · ${zoom}%`);
  }

  override onClose(): void {
    this.surface?.destroy();
    this.surface = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.contentEl.empty();
    if (this.dirty && !this.discarded) this.onSave(this.inkDoc);
  }
}
