import { describe, expect, it } from "vitest";
import {
  type InkDocument,
  type Stroke,
  emptyDocument,
  primaryRegion,
} from "../../src/model/document";
import { AddStroke, ClearRegion, MoveStrokes, RemoveStrokes } from "../../src/model/commands";
import { History } from "../../src/model/history";

function stroke(id: string, pts: number[] = [0, 0, 0.5]): Stroke {
  return { id, color: "#fff", size: 3, tool: "pen", pts };
}

function ids(doc: InkDocument): string[] {
  return primaryRegion(doc).strokes.map((s) => s.id);
}

describe("AddStroke", () => {
  it("apply appends, invert removes", () => {
    const doc = emptyDocument();
    const cmd = new AddStroke(stroke("s1"));
    cmd.apply(doc);
    expect(ids(doc)).toEqual(["s1"]);
    cmd.invert(doc);
    expect(ids(doc)).toEqual([]);
  });
});

describe("RemoveStrokes", () => {
  it("removes by id and restores original positions on invert", () => {
    const doc = emptyDocument();
    primaryRegion(doc).strokes = [stroke("a"), stroke("b"), stroke("c"), stroke("d")];
    const cmd = new RemoveStrokes(new Set(["b", "d"]));
    cmd.apply(doc);
    expect(ids(doc)).toEqual(["a", "c"]);
    cmd.invert(doc);
    expect(ids(doc)).toEqual(["a", "b", "c", "d"]);
  });

  it("is a no-op when nothing matches", () => {
    const doc = emptyDocument();
    primaryRegion(doc).strokes = [stroke("a")];
    const cmd = new RemoveStrokes(new Set(["x"]));
    cmd.apply(doc);
    expect(ids(doc)).toEqual(["a"]);
    cmd.invert(doc);
    expect(ids(doc)).toEqual(["a"]);
  });
});

describe("MoveStrokes", () => {
  it("translates matching strokes and inverts exactly", () => {
    const doc = emptyDocument();
    primaryRegion(doc).strokes = [stroke("a", [10, 20, 1, 30, 40, 1]), stroke("b", [0, 0, 1])];
    const cmd = new MoveStrokes(new Set(["a"]), 5, -3);
    cmd.apply(doc);
    expect(primaryRegion(doc).strokes[0].pts).toEqual([15, 17, 1, 35, 37, 1]);
    expect(primaryRegion(doc).strokes[1].pts).toEqual([0, 0, 1]);
    cmd.invert(doc);
    expect(primaryRegion(doc).strokes[0].pts).toEqual([10, 20, 1, 30, 40, 1]);
  });
});

describe("ClearRegion", () => {
  it("clears and restores", () => {
    const doc = emptyDocument();
    primaryRegion(doc).strokes = [stroke("a"), stroke("b")];
    const cmd = new ClearRegion();
    cmd.apply(doc);
    expect(ids(doc)).toEqual([]);
    cmd.invert(doc);
    expect(ids(doc)).toEqual(["a", "b"]);
  });
});

describe("History", () => {
  it("push applies and undo/redo round-trip", () => {
    const doc = emptyDocument();
    const history = new History();
    history.push(doc, new AddStroke(stroke("s1")));
    history.push(doc, new AddStroke(stroke("s2")));
    expect(ids(doc)).toEqual(["s1", "s2"]);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    history.undo(doc);
    expect(ids(doc)).toEqual(["s1"]);
    expect(history.canRedo()).toBe(true);

    history.redo(doc);
    expect(ids(doc)).toEqual(["s1", "s2"]);
  });

  it("a new push clears the redo stack", () => {
    const doc = emptyDocument();
    const history = new History();
    history.push(doc, new AddStroke(stroke("s1")));
    history.undo(doc);
    expect(history.canRedo()).toBe(true);
    history.push(doc, new AddStroke(stroke("s2")));
    expect(history.canRedo()).toBe(false);
    expect(ids(doc)).toEqual(["s2"]);
  });

  it("undo/redo return null at the ends", () => {
    const doc = emptyDocument();
    const history = new History();
    expect(history.undo(doc)).toBeNull();
    expect(history.redo(doc)).toBeNull();
  });

  it("honors the history limit (oldest dropped)", () => {
    const doc = emptyDocument();
    const history = new History(2);
    history.push(doc, new AddStroke(stroke("s1")));
    history.push(doc, new AddStroke(stroke("s2")));
    history.push(doc, new AddStroke(stroke("s3")));
    // Only the last two are undoable; s1 is committed permanently.
    history.undo(doc);
    history.undo(doc);
    expect(history.canUndo()).toBe(false);
    expect(ids(doc)).toEqual(["s1"]);
  });

  it("clear empties both stacks", () => {
    const doc = emptyDocument();
    const history = new History();
    history.push(doc, new AddStroke(stroke("s1")));
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
