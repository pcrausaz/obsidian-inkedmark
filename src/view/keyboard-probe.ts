/**
 * iPad keyboard layout probe (DOM, debug overlay only).
 *
 * On iPad the ink note's text panel ends up well above the on-screen keyboard
 * (the view shrinks by more than the keyboard's height). Obsidian sizes
 * `.app-container` as `100vh - --keyboard-height`; something adds to that and
 * it can't be reproduced off-device. While the debug overlay is on, focusing
 * the field records the layout chain (field → html) and viewport metrics at
 * each keyboard event, and hands the JSON to `save` once the keyboard has
 * settled.
 */

/** Samples taken this long after focus, besides the keyboard events. */
const SAMPLE_MS = [0, 150, 600, 1200];
const SAVE_MS = 1500;

const KEYBOARD_EVENTS = ["keyboardWillShow", "keyboardDidShow", "keyboardWillHide"] as const;

interface ChainEntry {
  el: string;
  top: number;
  bottom: number;
  height: number;
  style?: Record<string, string>;
  scrollTop?: number;
}

/**
 * Every stylesheet rule (and the inline style) that sets `el`'s bottom
 * padding, so the source of the keyboard padding can be named.
 */
function paddingSources(el: HTMLElement): string[] {
  const out: string[] = [];
  const inline = el.style.getPropertyValue("padding-bottom");
  if (inline) out.push(`inline: ${inline} ${el.style.getPropertyPriority("padding-bottom")}`);
  const visit = (rules: CSSRuleList, where: string): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const v = rule.style.getPropertyValue("padding-bottom");
        if (!v) continue;
        let hit = false;
        try {
          hit = el.matches(rule.selectorText);
        } catch {
          // Selector the engine can't match against; skip.
        }
        if (hit) {
          const prio = rule.style.getPropertyPriority("padding-bottom");
          out.push(`${where}: ${rule.selectorText} { ${v} ${prio}}`);
        }
      } else if ("cssRules" in rule) {
        visit((rule as CSSGroupingRule).cssRules, where);
      }
    }
  };
  for (const sheet of Array.from(el.doc.styleSheets)) {
    const owner = sheet.ownerNode as Element | null;
    const where = sheet.href ?? owner?.id ?? owner?.tagName.toLowerCase() ?? "sheet";
    try {
      visit(sheet.cssRules, where);
    } catch {
      out.push(`${where}: unreadable`);
    }
  }
  return out;
}

interface Sample {
  at: string;
  ms: number;
  innerHeight: number;
  clientHeight: number;
  vvHeight: number;
  vvOffsetTop: number;
  pageTop: number;
  keyboardHeight: string;
  bodyClasses: string;
  chain: ChainEntry[];
  /** Rules setting the view's bottom padding (view-content only). */
  paddingSources?: string[];
}

/** Styles worth reporting when they are not the default. */
const STYLE_KEYS = [
  "height",
  "maxHeight",
  "paddingBottom",
  "marginBottom",
  "bottom",
  "transform",
  "position",
] as const;
const DEFAULTS = new Set(["0px", "none", "auto", "static", "normal", ""]);

function label(el: Element): string {
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3) : [];
  return el.tagName.toLowerCase() + (cls.length && cls[0] ? "." + cls.join(".") : "");
}

function snapshot(field: HTMLElement, at: string, t0: number): Sample {
  const win = field.win;
  const doc = field.doc;
  const chain: ChainEntry[] = [];
  for (let el: HTMLElement | null = field; el; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    const cs = win.getComputedStyle(el);
    const style: Record<string, string> = {};
    for (const k of STYLE_KEYS) {
      const v = cs[k];
      if (!DEFAULTS.has(v) && !(k === "height" && el !== doc.documentElement)) style[k] = v;
    }
    const entry: ChainEntry = {
      el: label(el),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
    };
    if (Object.keys(style).length) entry.style = style;
    if (el.scrollTop) entry.scrollTop = el.scrollTop;
    chain.push(entry);
  }
  const vv = win.visualViewport;
  const view = field.closest<HTMLElement>(".view-content");
  return {
    at,
    ms: Math.round(performance.now() - t0),
    innerHeight: win.innerHeight,
    clientHeight: doc.documentElement.clientHeight,
    vvHeight: Math.round(vv?.height ?? 0),
    vvOffsetTop: Math.round(vv?.offsetTop ?? 0),
    pageTop: Math.round(vv?.pageTop ?? 0),
    keyboardHeight: win
      .getComputedStyle(doc.documentElement)
      .getPropertyValue("--keyboard-height")
      .trim(),
    bodyClasses: [...doc.body.classList]
      .filter((c) => /keyboard|mobile|tablet|phone|ios/.test(c))
      .join(" "),
    chain,
    paddingSources: view ? paddingSources(view) : undefined,
  };
}

/**
 * Start probing `field` focus sessions while `enabled()` is true. Returns a
 * dispose function.
 */
export function probeKeyboardLayout(
  field: HTMLElement,
  enabled: () => boolean,
  save: (json: string) => void,
): () => void {
  const win = field.win;
  let timers: number[] = [];
  let samples: Sample[] = [];
  let t0 = 0;
  let active = false;

  const clear = (): void => {
    for (const t of timers) win.clearTimeout(t);
    timers = [];
  };
  const take = (at: string): void => {
    if (active) samples.push(snapshot(field, at, t0));
  };
  const onFocus = (): void => {
    if (!enabled()) return;
    clear();
    active = true;
    t0 = performance.now();
    samples = [];
    for (const ms of SAMPLE_MS) timers.push(win.setTimeout(() => take(`focus+${ms}`), ms));
    timers.push(
      win.setTimeout(() => {
        active = false;
        save(
          JSON.stringify(
            { userAgent: win.navigator.userAgent, screen: win.screen.height, samples },
            null,
            1,
          ),
        );
      }, SAVE_MS),
    );
  };
  const onKeyboard = (e: Event): void => take(e.type);
  const onViewport = (): void => take("visualViewport.resize");

  field.addEventListener("focus", onFocus);
  for (const ev of KEYBOARD_EVENTS) win.addEventListener(ev, onKeyboard);
  win.visualViewport?.addEventListener("resize", onViewport);
  return () => {
    clear();
    field.removeEventListener("focus", onFocus);
    for (const ev of KEYBOARD_EVENTS) win.removeEventListener(ev, onKeyboard);
    win.visualViewport?.removeEventListener("resize", onViewport);
  };
}
