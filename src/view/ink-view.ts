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
  DEFAULT_PAPER_HEIGHT,
  FALLBACK_PRESSURE,
  MIN_SAMPLE_DISTANCE,
  PAPER_GROWTH_MARGIN,
  PALETTE,
  SIZES,
  VIEW_TYPE_INK,
} from "../constants";
import { Renderer, type StrokeStyle } from "../canvas/renderer";
import type { ViewportState } from "../canvas/viewport";
import { StrokeBuilder, type StrokeBuilderOptions, mapPressure } from "../ink/stroke-builder";
import {
  type InkDocument,
  type Stroke,
  documentBounds,
  emptyDocument,
  primaryRegion,
  strokeCount,
} from "../model/document";
import { buildInkFile, parseInkFile } from "../model/serialize";
import {
  PointerController,
  type PointerControllerCallbacks,
  type PointerSample,
} from "../input/pointer-controller";
import { ICON_INK_PEN } from "../icons";
import { Toolbar, type ToolbarState } from "./toolbar";
import type InkedMarkPlugin from "../main";

const MAX_DPR = 3;

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

  private toolbar: Toolbar | null = null;
  private toolState: ToolbarState;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: InkedMarkPlugin,
  ) {
    super(leaf);
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
    if (this.built) this.layout();
  }

  clear(): void {
    this.bodyText = "";
    this.doc = emptyDocument(this.plugin.settings.paperWidth);
    this.strokeSeq = 0;
    if (this.built) this.renderDry();
  }

  // --- Lifecycle ------------------------------------------------------------

  override async onOpen(): Promise<void> {
    this.buildDom();
    this.built = true;
    this.layout();
  }

  override async onClose(): Promise<void> {
    if (this.dryFrame) cancelAnimationFrame(this.dryFrame);
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
      onUndo: () => this.undoLastStroke(),
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
    this.renderer?.renderDocument(this.doc, this.toolState.pressureEnabled);
  }

  private currentStyle(): StrokeStyle {
    return {
      color: this.toolState.color,
      size: this.toolState.size,
      tool: this.toolState.tool,
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
      this.builder = new StrokeBuilder(this.builderOpts);
      this.builder.add(sample);
      this.renderer?.clearWet();
    },
    onMove: (coalesced, predicted) => {
      if (!this.builder) return;
      for (const sample of coalesced) this.builder.add(sample);
      const pts = this.builder.points();
      for (const sample of predicted) {
        pts.push(sample.x, sample.y, mapPressure(sample.pressure, this.builderOpts));
      }
      this.renderer?.renderWet(pts, this.currentStyle());
    },
    onEnd: (sample) => {
      this.commitStroke(sample);
    },
    onCancel: () => {
      this.builder = null;
      this.renderer?.clearWet();
    },
  };

  private commitStroke(final: PointerSample): void {
    const builder = this.builder;
    this.builder = null;
    this.renderer?.clearWet();
    if (!builder) return;

    builder.addFinal(final);
    // A single retained point is a valid dot; only drop truly empty strokes.
    if (builder.length < 1) return;

    const stroke: Stroke = {
      id: `s${++this.strokeSeq}`,
      color: this.toolState.color,
      size: this.toolState.size,
      tool: this.toolState.tool,
      pts: builder.points(),
    };
    primaryRegion(this.doc).strokes.push(stroke);

    this.ensurePaperHeight(this.surfaceEl.clientHeight);
    this.renderDry();
    this.requestSave();
  }

  private undoLastStroke(): void {
    const region = primaryRegion(this.doc);
    if (region.strokes.length === 0) return;
    region.strokes.pop();
    this.renderDry();
    this.requestSave();
  }

  private clearStrokes(): void {
    const region = primaryRegion(this.doc);
    if (region.strokes.length === 0) return;
    region.strokes = [];
    this.renderDry();
    this.requestSave();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      this.undoLastStroke();
      return;
    }

    switch (event.key.toLowerCase()) {
      case "p":
        this.setTool("pen");
        break;
      case "h":
        this.setTool("highlighter");
        break;
      default:
        break;
    }
  }

  private setTool(tool: ToolbarState["tool"]): void {
    this.toolState.tool = tool;
    this.toolbar?.setState(this.toolState);
  }
}
