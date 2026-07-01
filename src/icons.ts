/**
 * Bundled Lucide-derived icons registered via `addIcon`, so they work on mobile
 * WebKit where dynamically-fetched icons can fail. Each SVG carries explicit
 * width/height and a `0 0 100 100` viewBox (Obsidian's expected icon space).
 */

import { addIcon } from "obsidian";

export const ICON_INK_PEN = "inkedmark-pen";
export const ICON_INK_NOTE = "inkedmark-note";

// Lucide icons are authored in a 24x24 box; scale into Obsidian's 100x100.
function lucide(pathMarkup: string): string {
  return (
    `<g transform="scale(4.1667)" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pathMarkup}</g>`
  );
}

const PEN_PATH =
  '<path d="M12 19l7-7 3 3-7 7-3-3z"/>' +
  '<path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>' +
  '<path d="M2 2l7.586 7.586"/>' +
  '<circle cx="11" cy="11" r="2"/>';

const NOTE_PATH =
  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
  '<path d="M14 2v6h6"/>' +
  '<path d="M10 13l-2 4"/>' +
  '<path d="M14 12l-3 6"/>';

export function registerIcons(): void {
  addIcon(ICON_INK_PEN, lucide(PEN_PATH));
  addIcon(ICON_INK_NOTE, lucide(NOTE_PATH));
}
