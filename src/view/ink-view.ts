/**
 * `TextFileView` for `*.ink.md`: toolbar + vertical paper-roll canvas surface.
 *
 * Layout (all inside `contentEl`):
 *
 *   .inkedmark-view
 *     .inkedmark-toolbar          (built by Toolbar)
 *     .inkedmark-surface          position:relative, clips
 *       canvas.dry                pinned to the visible viewport
 *       canvas.wet                pinned to the visible viewport
 *       .inkedmark-scroll         transparent overlay; owns scrolling + input
 *         .inkedmark-paper        spacer that defines the scroll range
 *
 * The canvases are viewport-sized and redrawn on scroll (dry) / per-sample
 * (wet); the scroll overlay provides native scrolling and receives pointer
 * input. World coordinates are derived from the paper spacer's rect, which
 * already folds in both scroll position and horizontal centering.
 */

import { Notice, TextFileView, type WorkspaceLeaf } from "obsidian";
import {
  AUTO_RECOGNIZE_IDLE_MS,
  BLOCK_LABEL,
  BUILD_ID,
  DEFAULT_PAPER_HEIGHT,
  ERASER_RADIUS,
  FALLBACK_PRESSURE,
  MIN_SAMPLE_DISTANCE,
  PAPER_GROWTH_MARGIN,
  PALETTE,
  SIZES,
  VIEW_TYPE_INK,
} from "../constants";
import { Renderer, type StrokeStyle } from "../canvas/renderer";
import type { ViewportState } from "../canvas/viewport";
import {
  pointInBounds,
  rectFromCorners,
  strokeHitByPoint,
  strokeIntersectsRect,
} from "../canvas/hit-test";
import { SpatialIndex } from "../canvas/spatial-index";
import { anchorScrollDelta, clampScale } from "../canvas/zoom";
import { StrokeBuilder, type StrokeBuilderOptions, mapPressure } from "../ink/stroke-builder";
import {
  type Bounds,
  type InkDocument,
  type Stroke,
  type Tool,
  documentBounds,
  emptyDocument,
  primaryRegion,
  strokeBounds,
  strokeCount,
  strokesContentHash,
} from "../model/document";
import { AddStroke, ClearRegion, MoveStrokes, RemoveStrokes } from "../model/commands";
import { History } from "../model/history";
import { buildInkFile, parseInkFile, splitFrontmatter } from "../model/serialize";
import type { RecognitionProvider } from "../recognition/provider";
import { MANUAL_PROVIDER_ID } from "../recognition/manual";
import { providerLabel } from "../recognition/registry";
import { readTextSection, writeTextSection } from "../recognition/text-layer";
import {
  PointerController,
  type PointerControllerCallbacks,
  type PointerDebugRecord,
  type PointerSample,
} from "../input/pointer-controller";
import { ICON_INK_PEN } from "../icons";
import { Toolbar, type ToolbarState } from "./toolbar";
import type InkedMarkPlugin from "../main";

const MAX_DPR = 3;

function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

/**
 * Highest numeric `s<N>` id in the document. Seeding the sequence from the max
 * (not the count) prevents duplicate ids after erases: a file holding s1..s10
 * with two erased has 8 strokes, and counting would mint "s9" — which exists.
 */
function maxStrokeId(doc: InkDocument): number {
  let max = 0;
  for (const region of doc.regions) {
    for (const stroke of region.strokes) {
      const m = /^s(\d+)$/.exec(stroke.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

export class InkView extends TextFileView {
  private doc: InkDocument;
  private bodyText = "";

  private built = false;
  private surfaceEl!: HTMLElement;
  private paperBgEl!: HTMLElement;
  private scrollEl!: HTMLElement;
  private paperEl!: HTMLElement;
  private dryCanvas!: HTMLCanvasElement;
  private wetCanvas!: HTMLCanvasElement;

  private renderer: Renderer | null = null;
  private pointer: PointerController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dryFrame = 0;

  private viewport: ViewportState = { scrollY: 0, scale: 1, width: 0 };
  private offsetX = 0;
  private paperWorldWidth = 0;
  private scale = 1;

  private builder: StrokeBuilder | null = null;
  private builderOpts: StrokeBuilderOptions;
  private strokeSeq = 0;
  private readonly history = new History();
  private readonly index = new SpatialIndex();
  /** id -> stroke, so index hits resolve in O(1) instead of scanning the region. */
  private readonly strokeById = new Map<string, Stroke>();
  private eraseIds = new Set<string>();

  // Selection / move state (select tool).
  private selection = new Set<string>();
  private selectMode: "none" | "marquee" | "move" = "none";
  private marquee: Bounds | null = null;
  private marqueeOrigin: { x: number; y: number } | null = null;
  private moveLast: { x: number; y: number } | null = null;
  private moveDx = 0;
  private moveDy = 0;

  private toolbar: Toolbar | null = null;
  private toolState: ToolbarState;
  private readonly buildLabel: string;

  // Text-layer panel (searchable markdown body — prose only; frontmatter hidden).
  private textPanelEl: HTMLElement | null = null;
  private textArea: HTMLTextAreaElement | null = null;
  private showTextPanel = false;
  private frontmatter = "";

  // Wet-render throttle: coalesce many pointermoves into one draw per frame.
  private wetFrame = 0;
  private pendingPredicted: PointerSample[] = [];

  // Auto-recognition idle timer (opt-in setting).
  private autoRecognizeTimer = 0;

  // Bounded retry for layout() when the leaf has no size yet (first open).
  private layoutRetries = 0;

  /** Original file bytes when the last load was suspect; saves echo these. */
  private protectedRaw: string | null = null;

  // Diagnostic HUD state (toggled via command / settings).
  private debug: boolean;
  private hudEl: HTMLElement | null = null;
  private hudLog: Array<{ k: string; n: number }> = [];
  private hudMoves = 0;
  private hudPts = 0;
  private hudMaxGap = 0;
  private hudLastMoveT = 0;
  private hudPressure = 0;
  private hudMaxP = 0;
  private hudPointerType = "";
  private hudFrame = 0;
  private hudSumDown = 0;
  private hudSumUp = 0;
  private hudSumCancel = 0;

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
    this.builderOpts = {
      minDistance: MIN_SAMPLE_DISTANCE,
      pressureEnabled: this.toolState.pressureEnabled,
      fallbackPressure: FALLBACK_PRESSURE,
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
    this.strokeSeq = maxStrokeId(this.doc);
    this.history.clear();
    this.rebuildIndex();
    this.syncPanelFromBody();
    if (this.built) {
      this.layout();
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
    this.strokeSeq = 0;
    this.history.clear();
    this.index.clear();
    this.strokeById.clear();
    if (this.built) this.renderDry();
  }

  private rebuildIndex(): void {
    const strokes = primaryRegion(this.doc).strokes;
    this.index.rebuild(strokes);
    this.strokeById.clear();
    for (const stroke of strokes) this.strokeById.set(stroke.id, stroke);
  }

  // --- Lifecycle ------------------------------------------------------------

  override async onOpen(): Promise<void> {
    this.buildDom();
    this.built = true;
    this.layout();
    void this.plugin.maybeShowScribbleNotice();
  }

  override async onClose(): Promise<void> {
    if (this.dryFrame) cancelAnimationFrame(this.dryFrame);
    if (this.hudFrame) cancelAnimationFrame(this.hudFrame);
    if (this.wetFrame) cancelAnimationFrame(this.wetFrame);
    window.clearTimeout(this.autoRecognizeTimer);
    this.pointer?.detach();
    this.resizeObserver?.disconnect();
    this.toolbar?.destroy();
    this.contentEl.empty();
    this.built = false;
  }

  override onResize(): void {
    if (this.built) this.layout();
  }

  /** Reset zoom to 1 and scroll back to the top ("fit / reset"). */
  resetView(): void {
    if (!this.built) return;
    this.scale = 1;
    this.scrollEl.scrollTo({ top: 0, left: 0 });
    this.layout();
    this.updateStatus();
  }

  zoomIn(): void {
    if (this.built) this.zoomBy(1.25);
  }

  zoomOut(): void {
    if (this.built) this.zoomBy(1 / 1.25);
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
    this.layout();
  }

  // --- DOM construction -----------------------------------------------------

  private buildDom(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("inkedmark-view");

    // Factory-default ink is near-black; on a dark theme that is invisible, so
    // start with white when the user hasn't chosen a custom default color.
    if (this.toolState.color === PALETTE[0] && document.body.classList.contains("theme-dark")) {
      this.toolState.color = PALETTE[1];
    }

    const palette = [...PALETTE, ...this.plugin.settings.customColors];
    this.toolbar = new Toolbar(root, palette, SIZES, this.toolState, {
      onToolChange: (tool) => {
        this.toolState.tool = tool;
        if (tool !== "select") this.clearSelection();
      },
      onColorChange: (color) => {
        this.toolState.color = color;
      },
      onSizeChange: (size) => {
        this.toolState.size = size;
      },
      onPressureToggle: (enabled) => {
        this.toolState.pressureEnabled = enabled;
        this.builderOpts = { ...this.builderOpts, pressureEnabled: enabled };
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onClear: () => this.clearStrokes(),
      onZoomIn: () => this.zoomIn(),
      onZoomOut: () => this.zoomOut(),
      onZoomReset: () => this.resetView(),
      onToggleText: () => this.toggleTextPanel(),
      onRecognize: () => void this.plugin.runRecognition(this),
    });

    this.surfaceEl = root.createDiv({ cls: "inkedmark-surface" });
    this.paperBgEl = this.surfaceEl.createDiv({ cls: "inkedmark-paper-bg" });
    this.dryCanvas = this.surfaceEl.createEl("canvas", {
      cls: "inkedmark-canvas inkedmark-canvas-dry",
    });
    this.wetCanvas = this.surfaceEl.createEl("canvas", {
      cls: "inkedmark-canvas inkedmark-canvas-wet",
    });
    this.scrollEl = this.surfaceEl.createDiv({ cls: "inkedmark-scroll" });
    this.paperEl = this.scrollEl.createDiv({ cls: "inkedmark-paper" });

    this.hudEl = this.surfaceEl.createDiv({ cls: "inkedmark-hud" });
    this.hudEl.style.display = this.debug ? "" : "none";

    // Text-layer panel: the searchable markdown body (transcription, links, tags).
    this.textPanelEl = root.createDiv({ cls: "inkedmark-textpanel" });
    this.textPanelEl.createEl("div", {
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

    this.renderer = new Renderer(
      this.dryCanvas,
      this.wetCanvas,
      this.plugin.settings.desynchronizedCanvas,
    );
    this.renderer.highlighterAlpha = this.plugin.settings.highlighterAlpha;

    this.pointer = new PointerController(
      this.scrollEl,
      (cx, cy) => this.toWorld(cx, cy),
      this.pointerCallbacks,
    );
    this.pointer.attach();

    this.registerDomEvent(this.scrollEl, "scroll", () => this.onScroll());
    this.registerDomEvent(this.contentEl, "keydown", (e) => this.onKeyDown(e));

    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.surfaceEl);

    this.updateStatus();
  }

  /** Toolbar readout: build id + live committed-stroke count + zoom (a testing aid). */
  private updateStatus(): void {
    const engine = providerLabel(this.plugin.settings.recognitionProviderId);
    this.toolbar?.setRecognizeLabel(`Recognize handwriting — ${engine}`);
    const debugSuffix = this.debug ? ` · ${engine}` : "";
    const guard = this.protectedRaw !== null ? " · ⚠ protected (sync)" : "";
    this.toolbar?.setStatus(
      `${this.buildLabel} · ${strokeCount(this.doc)} strokes · ${Math.round(this.scale * 100)}%` +
        debugSuffix +
        guard,
    );
  }

  // --- Layout / rendering ---------------------------------------------------

  private layout(): void {
    if (!this.renderer) return;
    const cssW = this.surfaceEl.clientWidth;
    const cssH = this.surfaceEl.clientHeight;
    if (cssW === 0 || cssH === 0) {
      // First-open race: the leaf may not be attached/measured yet when the
      // view initializes (a blank canvas until something re-triggers layout).
      // Retry briefly; the ResizeObserver covers anything slower than this.
      if (this.layoutRetries < 60) {
        this.layoutRetries++;
        requestAnimationFrame(() => this.layout());
      }
      return;
    }
    this.layoutRetries = 0;

    // The roll's world width fits the surface at scale 1; zoom scales the visuals.
    this.paperWorldWidth = Math.min(this.plugin.settings.paperWidth, cssW);
    this.ensurePaperSize();

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.resize(cssW, cssH, dpr);
    this.syncViewport();
    this.renderDry();
  }

  /** Size the paper spacer (scroll range) in scaled/screen px. */
  private ensurePaperSize(): void {
    const bounds = documentBounds(this.doc);
    const contentBottom = bounds ? bounds.maxY + PAPER_GROWTH_MARGIN : 0;
    const surfaceH = this.surfaceEl.clientHeight;
    const worldHeight = Math.max(DEFAULT_PAPER_HEIGHT, contentBottom, surfaceH / this.scale);
    this.paperEl.style.width = `${Math.ceil(this.paperWorldWidth * this.scale)}px`;
    this.paperEl.style.height = `${Math.ceil(worldHeight * this.scale)}px`;
    this.paperEl.style.margin = "0 auto";
  }

  /** Derive scroll/offset (world) from the live paper vs surface rects. */
  private syncViewport(): void {
    if (!this.renderer) return;
    const surf = this.surfaceEl.getBoundingClientRect();
    const paper = this.paperEl.getBoundingClientRect();
    this.offsetX = paper.left - surf.left;
    const scrollY = (surf.top - paper.top) / this.scale;
    this.viewport = { scrollY, scale: this.scale, width: this.paperWorldWidth };
    this.renderer.setViewport(this.viewport, this.offsetX);
    this.paperBgEl.style.left = `${this.offsetX}px`;
    this.paperBgEl.style.width = `${paper.width}px`;
  }

  private onScroll(): void {
    this.syncViewport();
    this.scheduleDry();
  }

  /** Zoom about a client-space anchor, keeping the world point under it fixed. */
  private applyZoom(nextScale: number, anchorX: number, anchorY: number): void {
    const before = this.toWorld(anchorX, anchorY);
    this.scale = clampScale(nextScale);
    this.ensurePaperSize();
    this.syncViewport();
    const after = this.toWorld(anchorX, anchorY);
    const delta = anchorScrollDelta(before, after, this.scale);
    this.scrollEl.scrollLeft += delta.x;
    this.scrollEl.scrollTop += delta.y;
    this.syncViewport();
    this.renderDry();
    this.updateStatus();
  }

  private zoomBy(factor: number): void {
    const rect = this.surfaceEl.getBoundingClientRect();
    this.applyZoom(this.scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  private scheduleDry(): void {
    if (this.dryFrame) return;
    this.dryFrame = requestAnimationFrame(() => {
      this.dryFrame = 0;
      this.renderDry();
    });
  }

  private renderDry(): void {
    // `eraseIds` is empty except during a live erase gesture (preview).
    this.renderer?.renderDocument(
      this.doc,
      this.toolState.pressureEnabled,
      this.eraseIds,
      this.selectionBounds(),
    );
  }

  private selectionBounds(): Bounds | null {
    if (this.selection.size === 0) return null;
    let acc: Bounds | null = null;
    for (const id of this.selection) {
      const stroke = this.strokeById.get(id);
      if (!stroke) continue;
      const b = strokeBounds(stroke);
      if (!b) continue;
      acc = acc
        ? {
            minX: Math.min(acc.minX, b.minX),
            minY: Math.min(acc.minY, b.minY),
            maxX: Math.max(acc.maxX, b.maxX),
            maxY: Math.max(acc.maxY, b.maxY),
          }
        : b;
    }
    return acc;
  }

  /** The drawing tool for a produced stroke (eraser/select never produce one). */
  private strokeTool(): Tool {
    return this.toolState.tool === "highlighter" ? "highlighter" : "pen";
  }

  private currentStyle(): StrokeStyle {
    return {
      color: this.toolState.color,
      size: this.toolState.size,
      tool: this.strokeTool(),
      usePressure: this.toolState.pressureEnabled,
    };
  }

  // --- Input ----------------------------------------------------------------

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.paperEl.getBoundingClientRect();
    const scale = this.scale || 1;
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  }

  private readonly pointerCallbacks: PointerControllerCallbacks = {
    onStart: (sample) => {
      if (this.protectedRaw !== null) {
        new Notice("InkedMark: this note is protected until its ink data loads cleanly.");
        return;
      }
      if (this.toolState.tool === "eraser") {
        this.eraseIds = new Set();
        this.eraseAt(sample);
        return;
      }
      if (this.toolState.tool === "select") {
        this.selectStart(sample);
        return;
      }
      this.builder = new StrokeBuilder(this.builderOpts);
      this.builder.add(sample);
      this.renderer?.clearWet();
    },
    onMove: (coalesced, predicted) => {
      if (this.toolState.tool === "eraser") {
        for (const sample of coalesced) this.eraseAt(sample);
        return;
      }
      if (this.toolState.tool === "select") {
        this.selectMove(coalesced[coalesced.length - 1]);
        return;
      }
      if (!this.builder) return;
      // Retain every coalesced sample immediately (cheap), but defer the
      // expensive outline draw to one rAF per frame — drawing more often than
      // the display refreshes is wasted work that starves incoming events.
      for (const sample of coalesced) this.builder.add(sample);
      this.pendingPredicted = predicted;
      this.scheduleWet();
    },
    onEnd: (sample) => {
      if (this.toolState.tool === "eraser") {
        this.eraseCommit();
        return;
      }
      if (this.toolState.tool === "select") {
        this.selectEnd();
        return;
      }
      this.finishStroke(sample);
    },
    onCancel: () => {
      if (this.toolState.tool === "eraser") {
        this.eraseIds = new Set();
        this.renderDry();
        return;
      }
      if (this.toolState.tool === "select") {
        this.selectCancel();
        return;
      }
      // Salvage rather than discard: iOS can fire pointercancel on a normal pen
      // lift (e.g. when the surface briefly interprets the drag as a scroll), so
      // dropping the stroke here would make just-drawn ink vanish.
      this.finishStroke(null);
    },
    onPan: (deltaY) => {
      // Native touch-scroll is disabled (touch-action: none); drive it manually.
      // Setting scrollTop fires a scroll event -> onScroll() -> dry redraw.
      this.scrollEl.scrollTop += deltaY;
    },
    onPinch: (info) => {
      // Two-finger midpoint pan, then zoom about the pinch center.
      this.scrollEl.scrollLeft -= info.dxCss;
      this.scrollEl.scrollTop -= info.dyCss;
      this.applyZoom(this.scale * info.scaleFactor, info.centerX, info.centerY);
    },
    onDebug: (record) => this.onDebug(record),
  };

  // --- Diagnostic HUD -------------------------------------------------------

  /** Enable/disable the on-screen pointer-event overlay (also resets counters). */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
    if (enabled) {
      this.hudLog = [];
      this.hudSumDown = 0;
      this.hudSumUp = 0;
      this.hudSumCancel = 0;
    }
    if (this.hudEl) this.hudEl.style.display = enabled ? "" : "none";
    if (enabled) this.renderHud();
  }

  private onDebug(record: PointerDebugRecord): void {
    if (!this.debug) return;
    this.hudPointerType = record.pointerType;
    this.hudPressure = record.pressure;

    switch (record.type) {
      case "down":
        this.hudSumDown += 1;
        this.hudMoves = 0;
        this.hudPts = 0;
        this.hudMaxGap = 0;
        this.hudMaxP = 0;
        this.hudLastMoveT = record.timeStamp;
        this.pushHud("dn");
        break;
      case "move": {
        this.hudMoves += 1;
        this.hudPts += record.coalesced;
        if (record.pressure > this.hudMaxP) this.hudMaxP = record.pressure;
        const gap = record.timeStamp - this.hudLastMoveT;
        if (gap > this.hudMaxGap) this.hudMaxGap = gap;
        this.hudLastMoveT = record.timeStamp;
        const last = this.hudLog[this.hudLog.length - 1];
        if (last && last.k === "m") last.n += 1;
        else this.pushHud("m");
        break;
      }
      case "up":
        this.hudSumUp += 1;
        this.pushHud("up");
        break;
      case "cancel":
        this.hudSumCancel += 1;
        this.pushHud("cx");
        break;
    }
    this.scheduleHud();
  }

  private pushHud(k: string): void {
    this.hudLog.push({ k, n: 1 });
    if (this.hudLog.length > 30) this.hudLog.shift();
  }

  private scheduleHud(): void {
    if (this.hudFrame) return;
    this.hudFrame = requestAnimationFrame(() => {
      this.hudFrame = 0;
      this.renderHud();
    });
  }

  private renderHud(): void {
    if (!this.hudEl || !this.debug) return;
    const seq = this.hudLog.map((t) => (t.k === "m" ? `m·${t.n}` : t.k)).join(" ");
    this.hudEl.setText(
      `${seq}\n` +
        `cur mv=${this.hudMoves} pts=${this.hudPts} gap=${Math.round(this.hudMaxGap)}ms maxP=${this.hudMaxP.toFixed(2)}\n` +
        `Σ dn=${this.hudSumDown} up=${this.hudSumUp} cx=${this.hudSumCancel} commit=${strokeCount(this.doc)}\n` +
        `${this.hudPointerType || "-"} p=${this.hudPressure.toFixed(2)}`,
    );
  }

  private scheduleWet(): void {
    if (this.wetFrame || !this.builder) return;
    this.wetFrame = requestAnimationFrame(() => {
      this.wetFrame = 0;
      if (!this.builder) return;
      const pts = this.builder.points();
      for (const sample of this.pendingPredicted) {
        pts.push(sample.x, sample.y, mapPressure(sample.pressure, this.builderOpts));
      }
      this.renderer?.renderWet(pts, this.currentStyle());
    });
  }

  private finishStroke(final: PointerSample | null): void {
    if (this.wetFrame) {
      cancelAnimationFrame(this.wetFrame);
      this.wetFrame = 0;
    }
    const builder = this.builder;
    this.builder = null;
    this.renderer?.clearWet();
    if (!builder) return;

    if (final) builder.addFinal(final);
    // A single retained point is a valid dot; only drop truly empty strokes.
    if (builder.length < 1) return;

    const stroke: Stroke = {
      id: `s${++this.strokeSeq}`,
      color: this.toolState.color,
      size: this.toolState.size,
      tool: this.strokeTool(),
      pts: builder.points(),
    };
    // Record via the command stack (applies the add), then paint just this
    // stroke incrementally rather than re-outlining the whole document.
    this.history.push(this.doc, new AddStroke(stroke));
    this.index.insert(stroke);
    this.strokeById.set(stroke.id, stroke);

    this.ensurePaperSize();
    this.renderer?.appendCommittedStroke(stroke, this.toolState.pressureEnabled);
    this.updateStatus();
    this.scheduleAutoRecognize();
    this.requestSave();
  }

  // --- Eraser ---------------------------------------------------------------

  /** Add any strokes under the eraser to the pending set and preview-hide them. */
  private eraseAt(sample: { x: number; y: number }): void {
    const radius = ERASER_RADIUS / (this.viewport.scale || 1);
    let changed = false;
    for (const id of this.index.queryPoint(sample.x, sample.y, radius)) {
      if (this.eraseIds.has(id)) continue;
      const stroke = this.strokeById.get(id);
      if (stroke && strokeHitByPoint(stroke, sample.x, sample.y, radius)) {
        this.eraseIds.add(id);
        changed = true;
      }
    }
    if (changed) this.renderDry();
  }

  /** Commit the erase gesture as a single undoable RemoveStrokes command. */
  private eraseCommit(): void {
    const ids = this.eraseIds;
    this.eraseIds = new Set();
    if (ids.size === 0) return;
    this.history.push(this.doc, new RemoveStrokes(ids));
    for (const id of ids) {
      this.index.remove(id);
      this.strokeById.delete(id);
    }
    this.renderDry();
    this.updateStatus();
    this.scheduleAutoRecognize();
    this.requestSave();
  }

  // --- Selection / move -----------------------------------------------------

  private selectStart(sample: { x: number; y: number }): void {
    const bounds = this.selectionBounds();
    // Grab-to-move only when pressing inside the current selection box (padded).
    if (bounds && pointInBounds(sample.x, sample.y, padBounds(bounds, 8))) {
      this.selectMode = "move";
      this.moveLast = { x: sample.x, y: sample.y };
      this.moveDx = 0;
      this.moveDy = 0;
      return;
    }
    this.selectMode = "marquee";
    this.selection = new Set();
    this.marqueeOrigin = { x: sample.x, y: sample.y };
    this.marquee = rectFromCorners(sample.x, sample.y, sample.x, sample.y);
    this.renderDry();
    this.renderer?.renderMarquee(this.marquee);
  }

  private selectMove(sample: { x: number; y: number } | undefined): void {
    if (!sample) return;
    if (this.selectMode === "marquee" && this.marqueeOrigin) {
      this.marquee = rectFromCorners(
        this.marqueeOrigin.x,
        this.marqueeOrigin.y,
        sample.x,
        sample.y,
      );
      this.renderer?.renderMarquee(this.marquee);
      return;
    }
    if (this.selectMode === "move" && this.moveLast) {
      const dx = sample.x - this.moveLast.x;
      const dy = sample.y - this.moveLast.y;
      this.translateSelection(dx, dy);
      this.moveDx += dx;
      this.moveDy += dy;
      this.moveLast = { x: sample.x, y: sample.y };
      this.renderDry();
    }
  }

  private selectEnd(): void {
    if (this.selectMode === "marquee" && this.marquee) {
      this.applyMarqueeSelection(this.marquee);
      this.marquee = null;
      this.marqueeOrigin = null;
      this.selectMode = "none";
      this.renderer?.clearWet();
      this.renderDry();
      return;
    }
    if (this.selectMode === "move") {
      const dx = this.moveDx;
      const dy = this.moveDy;
      this.selectMode = "none";
      this.moveLast = null;
      if (dx !== 0 || dy !== 0) {
        // Undo the live translation, then record it as a command (which re-applies
        // it) so the move sits correctly on the undo stack.
        this.translateSelection(-dx, -dy);
        this.history.push(this.doc, new MoveStrokes(this.selection, dx, dy));
        this.rebuildIndex();
        this.renderDry();
        this.requestSave();
      }
    }
  }

  private selectCancel(): void {
    if (this.selectMode === "move") this.translateSelection(-this.moveDx, -this.moveDy);
    this.selectMode = "none";
    this.marquee = null;
    this.marqueeOrigin = null;
    this.moveLast = null;
    this.renderer?.clearWet();
    this.renderDry();
  }

  private applyMarqueeSelection(rect: Bounds): void {
    this.selection = new Set();
    for (const id of this.index.queryBounds(rect)) {
      const stroke = this.strokeById.get(id);
      if (stroke && strokeIntersectsRect(stroke, rect)) this.selection.add(id);
    }
  }

  private translateSelection(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    for (const id of this.selection) {
      const stroke = this.strokeById.get(id);
      if (!stroke) continue;
      for (let i = 0; i < stroke.pts.length; i += 3) {
        stroke.pts[i] += dx;
        stroke.pts[i + 1] += dy;
      }
    }
  }

  private deleteSelection(): void {
    if (this.selection.size === 0) return;
    const ids = this.selection;
    this.selection = new Set();
    this.history.push(this.doc, new RemoveStrokes(ids, "Delete selection"));
    for (const id of ids) {
      this.index.remove(id);
      this.strokeById.delete(id);
    }
    this.renderDry();
    this.updateStatus();
    this.scheduleAutoRecognize();
    this.requestSave();
  }

  private clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection = new Set();
    this.renderDry();
  }

  private undo(): void {
    if (!this.history.undo(this.doc)) return;
    this.rebuildIndex();
    this.renderDry();
    this.updateStatus();
    this.scheduleAutoRecognize();
    this.requestSave();
  }

  private redo(): void {
    if (!this.history.redo(this.doc)) return;
    this.rebuildIndex();
    this.renderDry();
    this.updateStatus();
    this.scheduleAutoRecognize();
    this.requestSave();
  }

  private clearStrokes(): void {
    const region = primaryRegion(this.doc);
    if (region.strokes.length === 0) return;
    this.history.push(this.doc, new ClearRegion());
    this.index.clear();
    this.strokeById.clear();
    // The auto-transcription mirrors the ink; clearing the page clears it too.
    // (User prose outside the managed section is untouched. Undo restores the
    // strokes but not the transcription - re-run recognition to regenerate it.)
    if (readTextSection(this.bodyText) !== null) {
      this.bodyText = writeTextSection(this.bodyText, "");
      this.syncPanelFromBody();
    }
    this.doc.recognizedHash = undefined;
    this.renderDry();
    this.updateStatus();
    this.requestSave();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }

    if ((event.key === "Delete" || event.key === "Backspace") && this.selection.size > 0) {
      event.preventDefault();
      this.deleteSelection();
      return;
    }

    switch (event.key.toLowerCase()) {
      case "p":
        this.setTool("pen");
        break;
      case "h":
        this.setTool("highlighter");
        break;
      case "e":
        this.setTool("eraser");
        break;
      case "v":
        this.setTool("select");
        break;
      default:
        break;
    }
  }

  private setTool(tool: ToolbarState["tool"]): void {
    this.toolState.tool = tool;
    this.toolbar?.setState(this.toolState);
    if (tool !== "select") this.clearSelection();
  }
}
