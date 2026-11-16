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
 *   can only be told apart while the pen hovers. Worse, a pen touching down
 *   with *only* that button held is claimed by Chromium's stylus text
 *   selection (`StylusTextSelector`, consulted in
 *   `RenderWidgetHostViewAndroid::OnTouchEvent` before the page): the whole
 *   touch stream is swallowed and the page never sees a `pointerdown` (#31).
 *   So on Android the primary button works as a *click while hovering* that
 *   toggles its tool (`HoverClickDetector`), not as hold-to-use.
 *   `BUTTON_STYLUS_SECONDARY` maps to the right bit and reaches the page
 *   normally. The eraser tool type behaves as on desktop.
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

/**
 * Android: how long a barrel press may last, while hovering, to count as a
 * click. Longer presses are someone holding the button to write, which
 * Chromium swallows (see module doc) — toggling then would surprise.
 */
export const HOVER_CLICK_MAX_MS = 800;

/**
 * Android: spots a barrel-button *click* (press + release) made while the pen
 * hovers. Feed it every hover sample and every pen-down; `hover` returns true
 * on the release that completes a click. A pen-down in between (the button was
 * held while writing, on a device that delivered the stroke) cancels it.
 */
export class HoverClickDetector {
  private pressedAt: number | null = null;
  private held = false;

  /** A hovering pen's `buttons` at time `t` (ms). True when a click just completed. */
  hover(buttons: number, t: number): boolean {
    const held = hoverBarrelHeld(buttons);
    const wasHeld = this.held;
    this.held = held;
    if (held && !wasHeld) {
      this.pressedAt = t;
      return false;
    }
    if (!held && wasHeld && this.pressedAt !== null) {
      const quick = t - this.pressedAt <= HOVER_CLICK_MAX_MS;
      this.pressedAt = null;
      return quick;
    }
    return false;
  }

  /** The pen touched down (a press spanning a stroke is not a click). */
  down(): void {
    this.pressedAt = null;
  }

  /** The pen left hover range: its button state is unknown until it returns. */
  reset(): void {
    this.pressedAt = null;
    this.held = false;
  }
}

/** The toolbar's tools (mirrors `ActiveTool`; kept here so this module stays pure). */
export type SelectableTool = "pen" | "highlighter" | "eraser" | "select";

/**
 * Android hover click: switch from `current` to the button's tool, or — when
 * it is already selected — back to `previous` (the tool before the last
 * toggle; pen if unknown). Returns the new tool and what to remember.
 */
export function toggledTool(
  current: SelectableTool,
  buttonTool: "eraser" | "highlighter",
  previous: SelectableTool | null,
): { tool: SelectableTool; previous: SelectableTool | null } {
  if (current === buttonTool) return { tool: previous ?? "pen", previous: null };
  return { tool: buttonTool, previous: current };
}
