import { describe, expect, it } from "vitest";
import {
  StrokeBuilder,
  type StrokeBuilderOptions,
  mapPressure,
} from "../../src/ink/stroke-builder";

const opts: StrokeBuilderOptions = {
  minDistance: 2,
  pressureEnabled: true,
  fallbackPressure: 0.5,
};

describe("mapPressure", () => {
  it("uses the fallback when pressure is disabled", () => {
    expect(mapPressure(0.9, { ...opts, pressureEnabled: false })).toBe(0.5);
  });

  it("uses the fallback when the device reports zero pressure", () => {
    expect(mapPressure(0, opts)).toBe(0.5);
  });

  it("passes through a valid pressure", () => {
    expect(mapPressure(0.73, opts)).toBeCloseTo(0.73, 5);
  });

  it("clamps pressure above one", () => {
    expect(mapPressure(1.5, opts)).toBe(1);
  });
});

describe("StrokeBuilder", () => {
  it("always retains the first sample", () => {
    const b = new StrokeBuilder(opts);
    expect(b.add({ x: 0, y: 0, pressure: 0.5 })).toBe(true);
    expect(b.length).toBe(1);
    expect(b.isEmpty).toBe(false);
  });

  it("decimates samples closer than minDistance", () => {
    const b = new StrokeBuilder(opts);
    b.add({ x: 0, y: 0, pressure: 0.5 });
    expect(b.add({ x: 1, y: 0, pressure: 0.5 })).toBe(false); // distance 1 < 2
    expect(b.add({ x: 3, y: 0, pressure: 0.5 })).toBe(true); // distance 3 >= 2
    expect(b.length).toBe(2);
  });

  it("addFinal forces a near point to be retained", () => {
    const b = new StrokeBuilder(opts);
    b.add({ x: 0, y: 0, pressure: 0.5 });
    expect(b.addFinal({ x: 0.1, y: 0, pressure: 0.9 })).toBe(true);
    expect(b.length).toBe(2);
  });

  it("stores mapped pressure in the flat buffer", () => {
    const b = new StrokeBuilder({ ...opts, pressureEnabled: false });
    b.add({ x: 0, y: 0, pressure: 0.9 });
    expect(b.points()).toEqual([0, 0, 0.5]);
  });

  it("points() returns a copy, not the internal buffer", () => {
    const b = new StrokeBuilder(opts);
    b.add({ x: 0, y: 0, pressure: 0.5 });
    const a = b.points();
    a[0] = 999;
    expect(b.points()[0]).toBe(0);
  });

  it("uses default options when none are given", () => {
    const b = new StrokeBuilder();
    expect(b.add({ x: 0, y: 0, pressure: 0.4 })).toBe(true);
    expect(b.add({ x: 0.2, y: 0, pressure: 0.4 })).toBe(false);
  });
});
