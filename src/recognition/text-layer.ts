/**
 * Pure sync rules between a region's recognized/typed text and the markdown
 * body (§5, §7). A managed section is delimited by HTML-comment markers so
 * automated writes (future HWR) update only that section and never touch the
 * user's own prose. In v1 the user edits the body directly; these helpers are
 * the seam a recognition provider writes through.
 *
 * No DOM, no Obsidian.
 */

export const SECTION_OPEN = "<!--inkedmark-text-->";
export const SECTION_CLOSE = "<!--/inkedmark-text-->";

const SECTION_RE = /\n*<!--inkedmark-text-->\n?([\s\S]*?)\n?<!--\/inkedmark-text-->\n?/;

/** The text inside the managed section, or null if there is none. */
export function readTextSection(body: string): string | null {
  const match = SECTION_RE.exec(body);
  return match ? match[1] : null;
}

/**
 * Upsert the managed section with `text` (removing it when `text` is blank),
 * preserving all other body content verbatim.
 */
export function writeTextSection(body: string, text: string): string {
  const match = SECTION_RE.exec(body);
  const trimmed = text.trim();

  if (match) {
    const before = body.slice(0, match.index);
    const after = body.slice(match.index + match[0].length);
    if (trimmed === "") return joinBody(before, after);
    return `${before}\n\n${SECTION_OPEN}\n${text}\n${SECTION_CLOSE}\n${after}`.replace(
      /\n{3,}/g,
      "\n\n",
    );
  }

  if (trimmed === "") return body;
  const base = body.replace(/\s+$/, "");
  const sep = base.length > 0 ? "\n\n" : "";
  return `${base}${sep}${SECTION_OPEN}\n${text}\n${SECTION_CLOSE}\n`;
}

function joinBody(before: string, after: string): string {
  const merged = `${before.replace(/\s+$/, "")}\n${after.replace(/^\s+/, "")}`;
  return merged.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}
