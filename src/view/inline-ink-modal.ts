/**
 * Editor for an inline ```inkedmark``` block: a modal hosting the shared
 * toolbar + `InkSurface`. The host note's reading view / Live Preview can't
 * take pen input in place (the block re-renders on every file change and the
 * page owns scrolling), so editing happens here and the result is written
 * back into the fenced block when the modal closes.
 *
 * The block's `caption:` line plays the role of the ink note's text layer: it
 * is the block's searchable text, editable in the text panel, and the target
 * of "Recognize handwriting" (the transcription is collapsed to one line).
 *
 * Closing (Done, ✕, Escape) saves when anything changed; "Discard changes"
 * throws the session's changes away (after confirming, when there are any).
 *
 * A transcription still running when the editor closes is not lost (#29): the
 * ink is saved right away, and the caption follows in a second save once the
 * provider answers. On mobile the caption sits under the toolbar, where the
 * on-screen keyboard can't cover it (#28).
 */

import { Modal, Notice, Platform } from "obsidian";
import { PALETTE, SIZES } from "../constants";
import { normalizePaperGuide } from "../canvas/guides";
import { type InkDocument, primaryRegion } from "../model/document";
import { MANUAL_PROVIDER_ID } from "../recognition/manual";
import type { RecognitionProvider } from "../recognition/provider";
import { providerLabel } from "../recognition/registry";
import { ConfirmModal } from "../ui/confirm-modal";
import { InkSurface } from "./ink-surface";
import { Toolbar, type ToolbarState } from "./toolbar";
import type InkedMarkPlugin from "../main";

export interface InlineInkResult {
  doc: InkDocument;
  /** Caption text (may be empty); `null` leaves the block's caption as it is. */
  caption: string | null;
}

// `Modal` already owns `doc` (an undocumented read-only getter for the owning
// Document), hence `inkDoc` below — never shadow base-class members here.
export class InlineInkModal extends Modal {
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private captionPanelEl: HTMLElement | null = null;
  private captionInput: HTMLInputElement | null = null;
  private showCaption = false;
  private caption: string | null;
  /** The caption was typed or transcribed this session (else saves leave it alone). */
  private captionTouched = false;
  private dirty = false;
  /** Strokes changed this session (drives auto-recognition on close). */
  private inkDirty = false;
  /** Bumped on every ink change, so a transcription knows if it is stale. */
  private inkVersion = 0;
  private discarded = false;
  private closed = false;
  /** Transcriptions in progress; closing waits for them before the caption save. */
  private readonly inFlight = new Set<Promise<void>>();
  private readonly toolState: ToolbarState;

  /**
   * @param inkDoc  document to edit (mutated in place)
   * @param caption the block's current caption, or null when it has none
   * @param onSave  called on close when something changed and wasn't discarded,
   *                and again if a transcription finishes after closing
   */
  constructor(
    private readonly plugin: InkedMarkPlugin,
    private readonly inkDoc: InkDocument,
    caption: string | null,
    private readonly onSave: (result: InlineInkResult) => void,
  ) {
    super(plugin.app);
    this.caption = caption;
    const { settings } = plugin;
    this.toolState = {
      tool: settings.defaultTool === "select" ? "pen" : settings.defaultTool,
      color: settings.defaultColor,
      size: settings.defaultSize,
      pressureEnabled: settings.pressureEnabled,
      guidesVisible: settings.paperGuideVisible,
    };
  }

  override onOpen(): void {
    const { settings } = this.plugin;
    this.modalEl.addClass("inkedmark-inline-modal");
    this.titleEl.setText("Inline handwriting");
    const root = this.contentEl;
    root.empty();
    root.addClass("inkedmark-inline-editor");

    const dark = activeDocument.body.classList.contains("theme-dark");
    if (this.toolState.color === PALETTE[0] && dark) this.toolState.color = PALETTE[1];

    const palette = [...PALETTE, ...settings.customColors];
    this.toolbar = new Toolbar(root, palette, SIZES, this.toolState, {
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
      onToggleGuides: () => void this.toggleGuides(),
      onToggleText: () => this.toggleCaptionPanel(),
      onRecognize: () => void this.plugin.runRecognition(this),
    });

    this.surface = new InkSurface(
      root,
      this.inkDoc,
      this.toolState,
      {
        paperWidth: settings.paperWidth,
        desynchronizedCanvas: settings.desynchronizedCanvas,
        highlighterAlpha: settings.highlighterAlpha,
        darkTheme: dark,
        paperGuide: settings.paperGuideVisible ? normalizePaperGuide(settings.paperGuide) : null,
        paperGuideSpacing: settings.paperGuideSpacing,
        debug: false,
        androidStylus: Platform.isAndroidApp,
        penButtonTool: (button) => this.plugin.penButtonTool(button),
      },
      {
        onChange: () => {
          this.dirty = true;
          this.inkDirty = true;
          this.inkVersion++;
        },
        onStatus: () => this.updateStatus(),
        onToolChange: () => this.toolbar?.setState(this.toolState),
      },
    );

    // Caption panel: the block's searchable text (the inline "text layer").
    this.captionPanelEl = root.createDiv({ cls: "inkedmark-textpanel" });
    this.captionPanelEl.createDiv({
      cls: "inkedmark-textpanel-label",
      text: "Caption — searchable text for this block",
    });
    this.captionInput = this.captionPanelEl.createEl("input", {
      cls: "inkedmark-inline-caption",
      type: "text",
      value: this.caption ?? "",
    });
    this.captionInput.placeholder = "Transcription or a few words…";
    this.captionInput.addEventListener("input", () => {
      this.caption = this.captionInput?.value ?? "";
      this.captionTouched = true;
      this.dirty = true;
    });
    this.captionPanelEl.style.display = this.showCaption ? "" : "none";
    if (Platform.isMobile) {
      // The on-screen keyboard covers the bottom of the screen (and Android
      // doesn't always shrink the modal), so keep the caption up top.
      this.captionPanelEl.addClass("inkedmark-caption-top");
      root.insertBefore(this.captionPanelEl, this.surface.surfaceEl);
    }

    const footer = root.createDiv({ cls: "inkedmark-inline-footer" });
    const hint = footer.createSpan({ cls: "inkedmark-inline-hint" });
    hint.setText(
      Platform.isMobile
        ? "Draw with the Pencil or a finger; saved into the note when you close."
        : "Saved into the note when you close. Cmd/Ctrl+Z undoes.",
    );
    const discard = footer.createEl("button", { text: "Discard changes" });
    discard.addEventListener("click", () => void this.discard());
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

  /** "Discard changes": confirm first when there is anything to lose (#30). */
  private async discard(): Promise<void> {
    if (this.dirty) {
      const confirmed = await ConfirmModal.confirm(this.app, {
        title: "Discard changes?",
        message:
          "Everything you drew or typed since opening this editor will be lost. " +
          "Done (or closing the editor) saves instead.",
        cta: "Discard",
        warning: true,
      });
      if (!confirmed) return;
    }
    this.discarded = true;
    this.close();
  }

  private toggleCaptionPanel(): void {
    this.showCaption = !this.showCaption;
    if (!this.captionPanelEl) return;
    this.captionPanelEl.style.display = this.showCaption ? "" : "none";
    if (this.showCaption) this.captionInput?.focus();
    this.surface?.layout();
  }

  /** Toolbar toggle: persist the preference, then mirror it on this (non-leaf) surface. */
  private async toggleGuides(): Promise<void> {
    const { settings } = this.plugin;
    await this.plugin.setPaperGuide({ visible: !settings.paperGuideVisible });
    this.toolState.guidesVisible = settings.paperGuideVisible;
    this.toolbar?.setState(this.toolState);
    this.surface?.setPaperGuide(
      settings.paperGuideVisible ? normalizePaperGuide(settings.paperGuide) : null,
      settings.paperGuideSpacing,
    );
  }

  private updateStatus(): void {
    const engine = providerLabel(this.plugin.settings.recognitionProviderId);
    this.toolbar?.setRecognizeLabel(`Recognize handwriting — ${engine}`);
    const n = this.surface?.strokeCount() ?? 0;
    const zoom = Math.round((this.surface?.zoom ?? 1) * 100);
    this.toolbar?.setStatus(`${n} strokes · ${zoom}%`);
  }

  /**
   * Recognition target (see `InkedMarkPlugin.runRecognition`, which handles
   * consent): transcribe the block's strokes into its caption.
   */
  async recognize(provider: RecognitionProvider, auto = false): Promise<void> {
    const run = this.transcribe(provider, auto);
    this.inFlight.add(run);
    try {
      await run;
    } finally {
      this.inFlight.delete(run);
    }
  }

  private async transcribe(provider: RecognitionProvider, auto: boolean): Promise<void> {
    const strokes = primaryRegion(this.inkDoc).strokes;
    const version = this.inkVersion;
    if (strokes.length === 0) {
      if (!auto) new Notice("InkedMark: nothing to recognize yet.");
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
      const text = result.text.replace(/\s*\n+\s*/g, " ").trim();
      if (text) {
        this.caption = text;
        this.captionTouched = true;
        if (this.captionInput) this.captionInput.value = text;
        this.dirty = true;
        // The caption now reflects this ink (unless more was drawn while the
        // request ran); a close-time auto pass would only repeat the request.
        if (this.inkVersion === version) this.inkDirty = false;
        if (this.closed) {
          if (!auto) new Notice("InkedMark: transcription saved as the block's caption.");
        } else {
          if (!this.showCaption) this.toggleCaptionPanel();
          new Notice("InkedMark: transcription added as the caption — review and edit it.");
        }
      } else if (!auto && !this.closed) {
        new Notice("InkedMark: manual transcription — type the caption in the text panel.");
        if (!this.showCaption) this.toggleCaptionPanel();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`InkedMark recognition failed: ${message}`, 8000);
    } finally {
      progress?.hide();
    }
  }

  override onClose(): void {
    this.closed = true;
    this.surface?.destroy();
    this.surface = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.captionPanelEl = null;
    this.captionInput = null;
    this.contentEl.empty();
    if (this.discarded) return;

    let savedCaption: string | null | undefined;
    const save = (): void => {
      savedCaption = this.caption;
      this.onSave({ doc: this.inkDoc, caption: this.captionTouched ? (this.caption ?? "") : null });
    };
    // The ink goes into the note now — never held hostage by a slow provider.
    if (this.dirty) save();

    // "Recognize automatically": an idle timer makes little sense in a modal
    // session, so the automatic pass runs once on close when the ink changed.
    // `auto` keeps it silent — no consent prompt, no chatter, and skipped for
    // providers that don't use the network (manual has nothing to add).
    const wantsAuto = (): boolean =>
      this.inkDirty &&
      this.plugin.settings.autoRecognize &&
      this.plugin.activeProvider().requiresNetwork;
    const pending = [...this.inFlight];
    if (pending.length === 0 && !wantsAuto()) return;

    void (async () => {
      try {
        // A transcription the user started before closing: let it land first.
        await Promise.allSettled(pending);
        if (wantsAuto()) await this.plugin.runRecognition(this, true);
      } finally {
        if (this.dirty && this.caption !== savedCaption) save();
      }
    })();
  }
}
