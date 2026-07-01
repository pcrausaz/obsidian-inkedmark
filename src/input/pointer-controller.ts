/**
 * Pointer input plumbing (DOM).
 *
 * Expands `getCoalescedEvents()` to capture the full Apple-Pencil sample rate
 * and `getPredictedEvents()` (where supported) for latency-compensated wet ink.
 * Coordinate mapping to world space is injected so this stays layout-agnostic.
 *
 * v1 scope: pen and mouse draw; a single finger pans (scrolls) the surface. We
 * drive the pan ourselves because the drawing surface uses `touch-action: none`
 * — on iOS WebKit a pen drag over a scrollable (`pan-y`) surface is otherwise
 * hijacked as a scroll, firing `pointercancel` and cutting the stroke short.
 * The full pen/touch arbitration + pinch-zoom lives in Phase 0.2
 * (`input/palm-rejection.ts`).
 */

import type { Vec2 } from "../canvas/viewport";
import { PalmRejection, kindOf } from "./palm-rejection";

export interface PointerSample {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
}

export type PointerDebugType = "down" | "move" | "up" | "cancel";

export interface PointerDebugRecord {
  type: PointerDebugType;
  pointerType: string;
  pointerId: number;
  pressure: number;
  /** Number of coalesced samples on a move (0 otherwise). */
  coalesced: number;
  /** Event timestamp (ms, monotonic) for gap/starvation measurement. */
  timeStamp: number;
}

export interface PointerControllerCallbacks {
  onStart(sample: PointerSample): void;
  /** `coalesced` carries every retained move sample; `predicted` is discarded on commit. */
  onMove(coalesced: PointerSample[], predicted: PointerSample[]): void;
  onEnd(sample: PointerSample): void;
  onCancel(): void;
  /** Single-finger vertical pan; `deltaY` is how far to scroll down, in px. */
  onPan?(deltaY: number): void;
  /** Two-finger pinch: incremental zoom factor about a client-space center, plus midpoint pan. */
  onPinch?(info: {
    scaleFactor: number;
    centerX: number;
    centerY: number;
    dxCss: number;
    dyCss: number;
  }): void;
  /** Raw drawing-pointer events, for the diagnostic HUD. */
  onDebug?(record: PointerDebugRecord): void;
}

interface TouchPoint {
  x: number;
  y: number;
}

export class PointerController {
  private activePointerId: number | null = null;
  private readonly touches = new Map<number, TouchPoint>();
  private pinchDist = 0;
  private pinchMid: TouchPoint = { x: 0, y: 0 };
  private readonly palm = new PalmRejection();

  constructor(
    private readonly el: HTMLElement,
    private readonly toWorld: (clientX: number, clientY: number) => Vec2,
    private readonly callbacks: PointerControllerCallbacks,
  ) {}

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

  private emitDebug(type: PointerDebugType, event: PointerEvent, coalesced: number): void {
    this.callbacks.onDebug?.({
      type,
      pointerType: event.pointerType,
      pointerId: event.pointerId,
      pressure: event.pressure,
      coalesced,
      timeStamp: event.timeStamp,
    });
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const role = this.palm.down(event.pointerId, kindOf(event.pointerType));

    if (role === "draw") {
      // A stylus landing cancels any in-progress finger gesture.
      this.touches.clear();
      if (this.activePointerId !== null) {
        // A previous stroke never received its pointerup — iOS drops it when you
        // lift and re-touch quickly (e.g. the down-stroke then the bar of a "T").
        // Finalize that stroke so this new one isn't dropped by the guard.
        this.release(this.activePointerId);
        this.callbacks.onCancel();
      }
      this.activePointerId = event.pointerId;
      this.el.setPointerCapture(event.pointerId);
      event.preventDefault();
      this.emitDebug("down", event, 0);
      this.callbacks.onStart(this.toSample(event));
      return;
    }

    if (role === "pan" || role === "pinch") {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size >= 2) this.initPinch();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) {
      event.preventDefault();
      const coalesced = (
        typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : []
      ).map((e) => this.toSample(e));
      if (coalesced.length === 0) coalesced.push(this.toSample(event));

      const predicted = (
        typeof event.getPredictedEvents === "function" ? event.getPredictedEvents() : []
      ).map((e) => this.toSample(e));

      this.emitDebug("move", event, coalesced.length);
      this.callbacks.onMove(coalesced, predicted);
      return;
    }

    const prev = this.touches.get(event.pointerId);
    if (!prev) return;
    const cur = { x: event.clientX, y: event.clientY };
    this.touches.set(event.pointerId, cur);

    if (this.touches.size === 1) {
      this.callbacks.onPan?.(prev.y - cur.y);
      return;
    }
    // Two fingers: incremental pinch-zoom + midpoint pan.
    const pair = this.firstTwoTouches();
    if (!pair || !this.callbacks.onPinch) return;
    const dist = distance(pair[0], pair[1]);
    const mid = midpoint(pair[0], pair[1]);
    if (this.pinchDist > 0) {
      this.callbacks.onPinch({
        scaleFactor: dist / this.pinchDist,
        centerX: mid.x,
        centerY: mid.y,
        dxCss: mid.x - this.pinchMid.x,
        dyCss: mid.y - this.pinchMid.y,
      });
    }
    this.pinchDist = dist;
    this.pinchMid = mid;
  };

  private initPinch(): void {
    const pair = this.firstTwoTouches();
    if (!pair) return;
    this.pinchDist = distance(pair[0], pair[1]);
    this.pinchMid = midpoint(pair[0], pair[1]);
  }

  private firstTwoTouches(): [TouchPoint, TouchPoint] | null {
    const it = this.touches.values();
    const a = it.next();
    const b = it.next();
    if (a.done || b.done) return null;
    return [a.value, b.value];
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.palm.up(event.pointerId);
    if (event.pointerId === this.activePointerId) {
      event.preventDefault();
      this.release(event.pointerId);
      this.emitDebug("up", event, 0);
      this.callbacks.onEnd(this.toSample(event));
      return;
    }
    this.endTouch(event.pointerId);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.palm.cancel(event.pointerId);
    if (event.pointerId === this.activePointerId) {
      this.release(event.pointerId);
      this.emitDebug("cancel", event, 0);
      this.callbacks.onCancel();
      return;
    }
    this.endTouch(event.pointerId);
  };

  /** Drop a finger; if one remains, re-seed the pinch baseline for a clean pan. */
  private endTouch(pointerId: number): void {
    if (!this.touches.delete(pointerId)) return;
    if (this.touches.size === 2) this.initPinch();
  }

  private release(pointerId: number): void {
    if (this.el.hasPointerCapture(pointerId)) this.el.releasePointerCapture(pointerId);
    this.activePointerId = null;
  }
}

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: TouchPoint, b: TouchPoint): TouchPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
