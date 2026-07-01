/**
 * Pen vs touch arbitration (§5.2), as a pure state machine so it is unit-testable
 * apart from the DOM. It classifies each pointer into a role:
 *
 * - A pen (or mouse) always **draws**, and going down cancels any finger gesture.
 * - While a pen is down, finger touches are **ignored** (palm rejection).
 * - Otherwise one finger **pans** and two fingers **pinch**; extra fingers are ignored.
 *
 * The DOM controller feeds it down/up/cancel events and acts on the returned role.
 */

export type PointerKind = "pen" | "touch" | "mouse";
export type PointerRole = "draw" | "pan" | "pinch" | "ignore";

export function kindOf(pointerType: string): PointerKind {
  if (pointerType === "pen") return "pen";
  if (pointerType === "touch") return "touch";
  return "mouse";
}

export class PalmRejection {
  private penDown = false;
  private drawId: number | null = null;
  private readonly touchIds: number[] = [];

  /** Register a pointer going down and return the role it should play. */
  down(id: number, kind: PointerKind): PointerRole {
    if (kind === "pen" || kind === "mouse") {
      this.penDown = true;
      this.drawId = id;
      // A stylus landing cancels any in-progress finger pan/pinch.
      this.touchIds.length = 0;
      return "draw";
    }
    if (this.penDown) return "ignore";
    if (!this.touchIds.includes(id)) {
      if (this.touchIds.length >= 2) return "ignore";
      this.touchIds.push(id);
    }
    return this.touchRole();
  }

  private touchRole(): PointerRole {
    return this.touchIds.length >= 2 ? "pinch" : "pan";
  }

  up(id: number): void {
    if (id === this.drawId) {
      this.penDown = false;
      this.drawId = null;
      return;
    }
    const i = this.touchIds.indexOf(id);
    if (i >= 0) this.touchIds.splice(i, 1);
  }

  cancel(id: number): void {
    this.up(id);
  }

  reset(): void {
    this.penDown = false;
    this.drawId = null;
    this.touchIds.length = 0;
  }

  get isPenDown(): boolean {
    return this.penDown;
  }

  get touchCount(): number {
    return this.touchIds.length;
  }

  get activeTouchIds(): readonly number[] {
    return this.touchIds;
  }
}
