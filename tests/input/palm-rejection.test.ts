import { describe, expect, it } from "vitest";
import { PalmRejection, kindOf } from "../../src/input/palm-rejection";

describe("kindOf", () => {
  it("maps pointerType strings", () => {
    expect(kindOf("pen")).toBe("pen");
    expect(kindOf("touch")).toBe("touch");
    expect(kindOf("mouse")).toBe("mouse");
    expect(kindOf("")).toBe("mouse");
  });
});

describe("PalmRejection", () => {
  it("a pen draws", () => {
    const pr = new PalmRejection();
    expect(pr.down(1, "pen")).toBe("draw");
    expect(pr.isPenDown).toBe(true);
  });

  it("a mouse draws", () => {
    const pr = new PalmRejection();
    expect(pr.down(1, "mouse")).toBe("draw");
  });

  it("one finger pans, a second pinches", () => {
    const pr = new PalmRejection();
    expect(pr.down(1, "touch")).toBe("pan");
    expect(pr.down(2, "touch")).toBe("pinch");
    expect(pr.touchCount).toBe(2);
  });

  it("ignores a third finger", () => {
    const pr = new PalmRejection();
    pr.down(1, "touch");
    pr.down(2, "touch");
    expect(pr.down(3, "touch")).toBe("ignore");
  });

  it("ignores fingers while a pen is down (palm rejection)", () => {
    const pr = new PalmRejection();
    pr.down(1, "pen");
    expect(pr.down(2, "touch")).toBe("ignore");
    expect(pr.touchCount).toBe(0);
  });

  it("a pen landing mid-gesture cancels finger touches", () => {
    const pr = new PalmRejection();
    pr.down(1, "touch");
    pr.down(2, "touch");
    expect(pr.touchCount).toBe(2);
    expect(pr.down(3, "pen")).toBe("draw");
    expect(pr.touchCount).toBe(0);
  });

  it("releasing the pen re-enables finger panning", () => {
    const pr = new PalmRejection();
    pr.down(1, "pen");
    pr.up(1);
    expect(pr.isPenDown).toBe(false);
    expect(pr.down(2, "touch")).toBe("pan");
  });

  it("lifting one of two fingers drops back to pan candidacy", () => {
    const pr = new PalmRejection();
    pr.down(1, "touch");
    pr.down(2, "touch");
    pr.up(1);
    expect(pr.touchCount).toBe(1);
    expect(pr.activeTouchIds).toEqual([2]);
  });

  it("cancel behaves like up", () => {
    const pr = new PalmRejection();
    pr.down(1, "touch");
    pr.cancel(1);
    expect(pr.touchCount).toBe(0);
  });

  it("reset clears everything", () => {
    const pr = new PalmRejection();
    pr.down(1, "pen");
    pr.down(2, "touch");
    pr.reset();
    expect(pr.isPenDown).toBe(false);
    expect(pr.touchCount).toBe(0);
  });
});
