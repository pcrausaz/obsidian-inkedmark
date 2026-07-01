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

import { TextFileView, type WorkspaceLeaf } from "obsidian";
import {
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
} from "../model/document";
import { AddStroke, ClearRegion, MoveStrokes, RemoveStrokes } from "../model/commands";
import { History } from "../model/history";
import { buildInkFile, parseInkFile } from "../model/serialize";
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
  private effectiveWidth = 0;

  private builder: StrokeBuilder | null = null;
  private builderOpts: StrokeBuilderOptions;
  private strokeSeq = 0;
  private readonly history = new History();
  private readonly index = new SpatialIndex();
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

  // Wet-render throttle: coalesce many pointermoves into one draw per frame.
  private wetFrame = 0;
  private pendingPredicted: PointerSample[] = [];

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
      tool: "pen",
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
    return buildInkFile(this.bodyText, this.doc);
  }

  setViewData(data: string, _clear: boolean): void {
    const parsed = parseInkFile(data, this.plugin.settings.paperWidth);
    this.bodyText = parsed.body;
    this.doc = parsed.doc ?? emptyDocument(this.plugin.settings.paperWidth);
    this.strokeSeq = strokeCount(this.doc);
    this.history.clear();
    this.rebuildIndex();
    if (this.built) {
      this.layout();
      this.updateStatus();
    }
  }

  clear(): void {
    this.bodyText = "";
    this.doc = emptyDocument(this.plugin.settings.paperWidth);
    this.strokeSeq = 0;
    this.history.clear();
    this.index.clear();
    if (this.built) this.renderDry();
  }

  private rebuildIndex(): void {
    this.index.rebuild(primaryRegion(this.doc).strokes);
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
    this.pointer?.detach();
    this.resizeObserver?.disconnect();
    this.toolbar?.destroy();
    this.contentEl.empty();
    this.built = false;
  }

  override onResize(): void {
    if (this.built) this.layout();
  }

  /** Scroll the paper roll back to the top (Phase 0.1 "fit / reset"). */
  resetView(): void {
    if (!this.built) return;
    this.scrollEl.scrollTo({ top: 0 });
    this.viewport = { ...this.viewport, scrollY: 0 };
    this.renderer?.setViewport(this.viewport, this.offsetX);
    this.renderDry();
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

    this.toolbar = new Toolbar(root, PALETTE, SIZES, this.toolState, {
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

    this.renderer = new Renderer(
      this.dryCanvas,
      this.wetCanvas,
      this.plugin.settings.desynchronizedCanvas,
    );

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

  /** Toolbar readout: build id + live committed-stroke count (a testing aid). */
  private updateStatus(): void {
    this.toolbar?.setStatus(`${this.buildLabel} · ${strokeCount(this.doc)} strokes`);
  }

  // --- Layout / rendering ---------------------------------------------------

  private layout(): void {
    if (!this.renderer) return;
    const cssW = this.surfaceEl.clientWidth;
    const cssH = this.surfaceEl.clientHeight;
    if (cssW === 0 || cssH === 0) return;

    this.effectiveWidth = Math.min(this.plugin.settings.paperWidth, cssW);
    this.offsetX = Math.max(0, Math.round((cssW - this.effectiveWidth) / 2));
    this.paperEl.style.width = `${this.effectiveWidth}px`;
    this.paperEl.style.marginLeft = `${this.offsetX}px`;
    this.paperBgEl.style.left = `${this.offsetX}px`;
    this.paperBgEl.style.width = `${this.effectiveWidth}px`;
    this.ensurePaperHeight(cssH);

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.renderer.resize(cssW, cssH, dpr);

    this.viewport = { scrollY: this.scrollEl.scrollTop, scale: 1, width: this.effectiveWidth };
    this.renderer.setViewport(this.viewport, this.offsetX);
    this.renderDry();
  }

  private ensurePaperHeight(viewportHeight: number): void {
    const bounds = documentBounds(this.doc);
    const contentBottom = bounds ? bounds.maxY + PAPER_GROWTH_MARGIN : 0;
    const height = Math.max(DEFAULT_PAPER_HEIGHT, viewportHeight, contentBottom);
    this.paperEl.style.height = `${Math.ceil(height)}px`;
  }

  private onScroll(): void {
    this.viewport = { ...this.viewport, scrollY: this.scrollEl.scrollTop };
    this.renderer?.setViewport(this.viewport, this.offsetX);
    this.scheduleDry();
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
    for (const stroke of primaryRegion(this.doc).strokes) {
      if (!this.selection.has(stroke.id)) continue;
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
    const scale = this.viewport.scale || 1;
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  }

  private readonly pointerCallbacks: PointerControllerCallbacks = {
    onStart: (sample) => {
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

    this.ensurePaperHeight(this.surfaceEl.clientHeight);
    this.renderer?.appendCommittedStroke(stroke, this.toolState.pressureEnabled);
    this.updateStatus();
    this.requestSave();
  }

  // --- Eraser ---------------------------------------------------------------

  /** Add any strokes under the eraser to the pending set and preview-hide them. */
  private eraseAt(sample: { x: number; y: number }): void {
    const radius = ERASER_RADIUS / (this.viewport.scale || 1);
    const region = primaryRegion(this.doc);
    let changed = false;
    for (const id of this.index.queryPoint(sample.x, sample.y, radius)) {
      if (this.eraseIds.has(id)) continue;
      const stroke = region.strokes.find((s) => s.id === id);
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
    for (const id of ids) this.index.remove(id);
    this.renderDry();
    this.updateStatus();
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
    const region = primaryRegion(this.doc);
    for (const id of this.index.queryBounds(rect)) {
      const stroke = region.strokes.find((s) => s.id === id);
      if (stroke && strokeIntersectsRect(stroke, rect)) this.selection.add(id);
    }
  }

  private translateSelection(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    for (const stroke of primaryRegion(this.doc).strokes) {
      if (!this.selection.has(stroke.id)) continue;
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
    for (const id of ids) this.index.remove(id);
    this.renderDry();
    this.updateStatus();
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
    this.requestSave();
  }

  private redo(): void {
    if (!this.history.redo(this.doc)) return;
    this.rebuildIndex();
    this.renderDry();
    this.updateStatus();
    this.requestSave();
  }

  private clearStrokes(): void {
    const region = primaryRegion(this.doc);
    if (region.strokes.length === 0) return;
    this.history.push(this.doc, new ClearRegion());
    this.index.clear();
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
