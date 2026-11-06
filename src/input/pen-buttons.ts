/**
 * Stylus button decoding (pure — no DOM, no Obsidian).
 *
 * A pen touching down while one of its buttons is held picks a temporary tool
 * for that stroke (issue #31). What the page sees depends on the platform:
 *
 * - **Standard** (Windows, macOS, Linux; W3C Pointer Events): the eraser end
 *   sets bit 32 (Blink also clears the contact bit), the barrel button sets
 *   bit 2 (right) and a second barrel button bit 4 (middle).
 * - **Android** (Chromium WebView): `BUTTON_STYLUS_PRIMARY` is mapped to the
 *   *left* bit — the same bit as tip contact — so the primary barrel button
 *   can only be told apart while the pen hovers. `BUTTON_STYLUS_SECONDARY`
 *   maps to the right bit. The eraser tool type behaves as on desktop.
 * - **iPadOS**: Apple Pencil buttons/squeeze never reach web content; nothing
 *   here ever fires.
 */

/** Which pen button is held: the eraser end, the (first) barrel button, or a second one. */
export type PenButton = "eraser" | "barrel" | "barrel2";

/** `PointerEvent.buttons` bits. */
const LEFT = 1;
const RIGHT = 2;
const MIDDLE = 4;
const ERASER = 32;

/**
 * The pen button held as the pen touches down, or null for a plain tip.
 *
 * @param buttons     `PointerEvent.buttons` of the pen's `pointerdown`
 * @param android     Chromium-on-Android button mapping (see module doc)
 * @param hoverBarrel Android only: the primary barrel button was seen held
 *                    while the pen hovered just before touching down
 */
export function penButtonAtDown(
  buttons: number,
  android: boolean,
  hoverBarrel: boolean,
): PenButton | null {
  if (buttons & ERASER) return "eraser";
  if (android) {
    if (buttons & RIGHT) return "barrel2";
    return hoverBarrel ? "barrel" : null;
  }
  if (buttons & RIGHT) return "barrel";
  if (buttons & MIDDLE) return "barrel2";
  return null;
}

/**
 * Android: a *hovering* pen reporting the left bit has its primary barrel
 * button held (no tip contact is possible while hovering).
 */
export function hoverBarrelHeld(buttons: number): boolean {
  return (buttons & LEFT) !== 0;
}

/** What a pen button does: switch to a tool for that stroke, or nothing. */
export type PenButtonAction = "eraser" | "highlighter" | "none";

export const PEN_BUTTON_ACTION_LABELS: Record<PenButtonAction, string> = {
  eraser: "Eraser",
  highlighter: "Highlighter",
  none: "Nothing",
};

/** Coerce a stored setting to a known action (synced data may be stale). */
export function normalizePenButtonAction(
  value: unknown,
  fallback: PenButtonAction,
): PenButtonAction {
  return value === "eraser" || value === "highlighter" || value === "none" ? value : fallback;
}

/**
 * The tool a held button switches to, or null to keep the selected tool. The
 * eraser end always erases — it is an eraser, physically.
 */
export function penButtonTool(
  button: PenButton | null,
  barrelAction: PenButtonAction,
  barrel2Action: PenButtonAction,
): "eraser" | "highlighter" | null {
  if (button === null) return null;
  if (button === "eraser") return "eraser";
  const action = button === "barrel" ? barrelAction : barrel2Action;
  return action === "none" ? null : action;
}
