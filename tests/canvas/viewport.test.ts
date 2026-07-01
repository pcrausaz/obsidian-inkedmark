import { describe, expect, it } from "vitest";
import {
  makeViewport,
  screenToWorld,
  visibleWorldRange,
  worldToScreen,
} from "../../src/canvas/viewport";

describe("viewport", () => {
  it("screenToWorld and worldToScreen are inverses (scale 1)", () => {
    const vp = makeViewport(1024, 150, 1);
    const world = screenToWorld(vp, 40, 60);
    expect(world).toEqual({ x: 40, y: 210 });
    expect(worldToScreen(vp, world.x, world.y)).toEqual({ x: 40, y: 60 });
  });

  it("accounts for scale in both directions", () => {
    const vp = makeViewport(1024, 100, 2);
    const world = screenToWorld(vp, 80, 80);
    expect(world).toEqual({ x: 40, y: 140 });
    expect(worldToScreen(vp, world.x, world.y)).toEqual({ x: 80, y: 80 });
  });

  it("computes the visible world range for a viewport height", () => {
    const vp = makeViewport(1024, 200, 2);
    expect(visibleWorldRange(vp, 600)).toEqual({ top: 200, bottom: 500 });
  });
});
