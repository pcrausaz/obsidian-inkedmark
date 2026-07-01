/**
 * Live wet-stroke assembly from raw input samples: min-distance decimation and
 * pressure mapping. Produces the flat `[x, y, p, …]` buffer the model stores.
 *
 * Pure: no DOM. The DOM-side coalesced/predicted event plumbing lives in
 * `input/pointer-controller.ts`; it feeds samples here.
 */

import { FALLBACK_PRESSURE, MIN_SAMPLE_DISTANCE } from "../constants";

export interface InputSample {
  /** World-space x (CSS px). */
  x: number;
  /** World-space y (CSS px). */
  y: number;
  /** Raw pointer pressure in `0..1` (0 for devices that report none). */
  pressure: number;
}

export interface StrokeBuilderOptions {
  /** Minimum world distance between retained samples, in CSS px. */
  minDistance: number;
  /** When false, every point uses {@link StrokeBuilderOptions.fallbackPressure}. */
  pressureEnabled: boolean;
  /** Pressure used for mouse input or when pressure is disabled. */
  fallbackPressure: number;
}

export const DEFAULT_BUILDER_OPTIONS: StrokeBuilderOptions = {
  minDistance: MIN_SAMPLE_DISTANCE,
  pressureEnabled: true,
  fallbackPressure: FALLBACK_PRESSURE,
};

/** Map a raw pointer pressure to the normalized value stored in a point. */
export function mapPressure(raw: number, options: StrokeBuilderOptions): number {
  if (!options.pressureEnabled) return options.fallbackPressure;
  if (!(raw > 0)) return options.fallbackPressure;
  return raw < 1 ? raw : 1;
}

/**
 * Accumulates retained points for a single in-progress stroke. Samples closer
 * than `minDistance` to the previous retained point are dropped, except a
 * forced final sample (so the stroke ends exactly where the pen lifts).
 */
export class StrokeBuilder {
  private readonly opts: StrokeBuilderOptions;
  private readonly pts: number[] = [];
  private lastX = NaN;
  private lastY = NaN;

  constructor(options: Partial<StrokeBuilderOptions> = {}) {
    this.opts = { ...DEFAULT_BUILDER_OPTIONS, ...options };
  }

  /** Add a sample. Returns true if it was retained, false if decimated. */
  add(sample: InputSample): boolean {
    return this.push(sample, false);
  }

  /** Force-add a sample regardless of distance (use for the pen-up point). */
  addFinal(sample: InputSample): boolean {
    return this.push(sample, true);
  }

  private push(sample: InputSample, force: boolean): boolean {
    const pressure = mapPressure(sample.pressure, this.opts);
    if (this.pts.length === 0) {
      this.pts.push(sample.x, sample.y, pressure);
      this.lastX = sample.x;
      this.lastY = sample.y;
      return true;
    }
    if (!force) {
      const dx = sample.x - this.lastX;
      const dy = sample.y - this.lastY;
      if (dx * dx + dy * dy < this.opts.minDistance * this.opts.minDistance) {
        return false;
      }
    }
    this.pts.push(sample.x, sample.y, pressure);
    this.lastX = sample.x;
    this.lastY = sample.y;
    return true;
  }

  /** Number of retained points. */
  get length(): number {
    return this.pts.length / 3;
  }

  /** True once there is at least one retained point. */
  get isEmpty(): boolean {
    return this.pts.length === 0;
  }

  /** A copy of the retained flat point buffer. */
  points(): number[] {
    return this.pts.slice();
  }
}
