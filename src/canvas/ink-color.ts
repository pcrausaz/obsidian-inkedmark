/**
 * Theme-adaptive ink resolution. Monochrome ink (the default black/white
 * swatches) is stored as the hex the user picked, but *means* "default ink" —
 * so at render time both extremes map to whatever is legible on the current
 * paper: white ink on a dark theme, near-black on a light one. Without this, a
 * note written in white on a dark-mode device renders invisibly on a
 * light-mode device (and vice versa). Deliberate colors are never remapped.
 *
 * Pure. No DOM.
 */

/** Ink used on dark paper. */
export const INK_ON_DARK = "#ffffff";
/** Ink used on light paper. */
export const INK_ON_LIGHT = "#1a1a1a";

/** Colors that mean "default ink" rather than a deliberate hue. */
const THEME_INKS = new Set(["#ffffff", "#fff", "#1a1a1a", "#000000", "#000"]);

export function isThemeInk(color: string): boolean {
  return THEME_INKS.has(color.trim().toLowerCase());
}

/** The color to actually paint, given the stored color and the paper theme. */
export function resolveInkColor(color: string, darkTheme: boolean): string {
  if (!isThemeInk(color)) return color;
  return darkTheme ? INK_ON_DARK : INK_ON_LIGHT;
}
