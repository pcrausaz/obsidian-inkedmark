/**
 * iOS keyboard vs. a text field at the bottom of a view (DOM).
 *
 * Obsidian shrinks `.app-container` by `--keyboard-height` once the keyboard
 * is up, but only after its show animation (during `keyboard-animating` the
 * app keeps full height). A field focused near the bottom is therefore
 * hidden by the incoming keyboard at focus time, and WebKit scrolls layout
 * containers that never scroll otherwise to reveal it. When the app then
 * shrinks, that offset remains — the field ends up a keyboard-height above
 * the keyboard. Obsidian's own editor avoids this by padding its own
 * scroller; here we undo the stray scroll once the keyboard has settled.
 *
 * `report` (debug overlay on) receives what was found, for field diagnosis.
 */

const SETTLE_MS = 450;

export function keepFieldAboveKeyboard(
  field: HTMLElement,
  report?: (summary: string) => void,
): () => void {
  const win = field.win;
  let timer = 0;

  const reset = (): void => {
    if (field.doc.activeElement !== field) return;
    const moved: string[] = [];
    for (let el = field.parentElement; el; el = el.parentElement) {
      if (el.scrollTop !== 0) {
        moved.push(`${el.className.split(" ")[0] || el.tagName.toLowerCase()}=${el.scrollTop}`);
        el.scrollTop = 0;
      }
    }
    if (win.scrollY !== 0) {
      moved.push(`window=${win.scrollY}`);
      win.scrollTo(0, 0);
    }
    if (report) {
      const vv = win.visualViewport;
      const kb = getComputedStyle(field.doc.documentElement).getPropertyValue("--keyboard-height");
      report(
        `reset ${moved.join(", ") || "nothing"} · ih=${win.innerHeight}` +
          ` vv=${Math.round(vv?.height ?? 0)}@${Math.round(vv?.offsetTop ?? 0)} kb=${kb.trim()}`,
      );
    }
  };
  const later = (): void => {
    win.clearTimeout(timer);
    timer = win.setTimeout(reset, SETTLE_MS);
  };

  // Obsidian's mobile shell dispatches these on window (Capacitor keyboard).
  win.addEventListener("keyboardDidShow", reset);
  field.addEventListener("focus", later);
  return () => {
    win.clearTimeout(timer);
    win.removeEventListener("keyboardDidShow", reset);
    field.removeEventListener("focus", later);
  };
}
