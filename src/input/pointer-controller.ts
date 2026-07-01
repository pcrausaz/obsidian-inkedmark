/**
 * Pointer input plumbing (DOM).
 *
 * Expands `getCoalescedEvents()` to capture the full Apple-Pencil sample rate
 * and `getPredictedEvents()` (where supported) for latency-compensated wet ink.
 * Coordinate mapping to world space is injected so this stays layout-agnostic.
 *
 * v1 scope: pen and mouse draw; finger touches are left alone so the surface
 * can scroll. The full pen/touch arbitration state machine is Phase 0.2
 * (`input/palm-rejection.ts`).
 */

import type { Vec2 } from "../canvas/viewport";

export interface PointerSample {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
}

export interface PointerControllerCallbacks {
  onStart(sample: PointerSample): void;
  /** `coalesced` carries every retained move sample; `predicted` is discarded on commit. */
  onMove(coalesced: PointerSample[], predicted: PointerSample[]): void;
  onEnd(sample: PointerSample): void;
  onCancel(): void;
}

export interface PointerControllerOptions {
  /** Whether a given pointer should draw. Defaults to pen + mouse. */
  shouldDraw?: (event: PointerEvent) => boolean;
}

function defaultShouldDraw(event: PointerEvent): boolean {
  return event.pointerType === "pen" || event.pointerType === "mouse";
}

export class PointerController {
  private activePointerId: number | null = null;
  private readonly shouldDraw: (event: PointerEvent) => boolean;

  constructor(
    private readonly el: HTMLElement,
    private readonly toWorld: (clientX: number, clientY: number) => Vec2,
    private readonly callbacks: PointerControllerCallbacks,
    options: PointerControllerOptions = {},
  ) {
    this.shouldDraw = options.shouldDraw ?? defaultShouldDraw;
  }

  attach(): void {
    this.el.addEventListener("pointerdown", this.onPointerDown);
    this.el.addEventListener("pointermove", this.onPointerMove);
    this.el.addEventListener("pointerup", this.onPointerUp);
    this.el.addEventListener("pointercancel", this.onPointerCancel);
  }

  detach(): void {
    this.el.removeEventListener("pointerdown", this.onPointerDown);
    this.el.removeEventListener("pointermove", this.onPointerMove);
    this.el.removeEventListener("pointerup", this.onPointerUp);
    this.el.removeEventListener("pointercancel", this.onPointerCancel);
  }

  private toSample(event: PointerEvent): PointerSample {
    const { x, y } = this.toWorld(event.clientX, event.clientY);
    return { x, y, pressure: event.pressure, tiltX: event.tiltX, tiltY: event.tiltY };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    if (!this.shouldDraw(event)) return;
    this.activePointerId = event.pointerId;
    this.el.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.callbacks.onStart(this.toSample(event));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();

    const coalesced = (
      typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : []
    ).map((e) => this.toSample(e));
    if (coalesced.length === 0) coalesced.push(this.toSample(event));

    const predicted = (
      typeof event.getPredictedEvents === "function" ? event.getPredictedEvents() : []
    ).map((e) => this.toSample(e));

    this.callbacks.onMove(coalesced, predicted);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    this.release(event.pointerId);
    this.callbacks.onEnd(this.toSample(event));
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.release(event.pointerId);
    this.callbacks.onCancel();
  };

  private release(pointerId: number): void {
    if (this.el.hasPointerCapture(pointerId)) this.el.releasePointerCapture(pointerId);
    this.activePointerId = null;
  }
}
