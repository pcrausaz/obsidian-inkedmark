/**
 * Parsing for the inline ```inkedmark``` fenced block (§4.2):
 *
 *   ```inkedmark
 *   caption: Quick margin sketch
 *   v1:<base64(deflate(strokeDocJSON))>
 *   ```
 *
 * Pure: no DOM, no Obsidian. The `caption:` line is the searchable text for the
 * inline block; the `v<n>:` line is the stroke payload (see serialize.ts).
 */

export interface InlineBlock {
  caption: string | null;
  payload: string | null;
}

export function parseInlineBlock(source: string): InlineBlock {
  let caption: string | null = null;
  let payload: string | null = null;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (payload === null && /^v\d+:/.test(line)) {
      payload = line;
      continue;
    }
    if (caption === null) {
      const m = /^caption:\s*(.*)$/i.exec(line);
      if (m) {
        caption = m[1].trim() || null;
        continue;
      }
    }
  }

  return { caption, payload };
}

/** Build a starter inline block from an encoded payload and optional caption. */
export function buildInlineBlock(payload: string, caption = ""): string {
  const captionLine = caption ? `caption: ${caption}\n` : "caption: \n";
  return "```inkedmark\n" + captionLine + payload + "\n```\n";
}

/**
 * Return `source` with its stroke payload replaced by `payload` and, when
 * `caption` is given, its `caption:` line replaced (or inserted at the top).
 * Every other line is kept verbatim. Without an existing payload line the
 * payload is appended.
 */
export function updateInlineBlockSource(
  source: string,
  payload: string,
  caption: string | null = null,
): string {
  const lines = source.split(/\r?\n/);
  // Drop a single trailing blank line so appended lines sit inside the block.
  if (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
  const at = lines.findIndex((line) => /^v\d+:/.test(line.trim()));
  if (at >= 0) lines[at] = payload;
  else if (lines.length === 1 && lines[0].trim() === "") lines[0] = payload;
  else lines.push(payload);
  if (caption !== null) {
    const captionLine = `caption: ${caption}`.trimEnd() + (caption ? "" : " ");
    const c = lines.findIndex((line) => /^caption:/i.test(line.trim()));
    if (c >= 0) lines[c] = captionLine;
    else lines.unshift(captionLine);
  }
  return lines.join("\n");
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*inkedmark\b/;

/** Line range (0-based, inclusive) of a fenced ```inkedmark``` block, fences included. */
export interface BlockRange {
  lineStart: number;
  lineEnd: number;
}

/** Every fenced ```inkedmark``` block in a note, in order. */
export function inlineBlockRanges(note: string): BlockRange[] {
  const lines = note.split("\n");
  const ranges: BlockRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) continue;
    const fence = open[1];
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.startsWith(fence[0].repeat(fence.length)) && /^[`~]+\s*$/.test(t)) {
        ranges.push({ lineStart: i, lineEnd: j });
        i = j;
        break;
      }
    }
  }
  return ranges;
}

/** Inner text (between the fences) of the block at `range`. */
export function blockInner(note: string, range: BlockRange): string {
  return note
    .split("\n")
    .slice(range.lineStart + 1, range.lineEnd)
    .join("\n");
}

/**
 * Locate a fenced ```inkedmark``` block whose inner text equals `source` in a
 * note. `hint` (from Obsidian's `getSectionInfo`) is checked first; when it no
 * longer matches (the note changed underneath the render), the whole note is
 * scanned and the block is returned only if it is unambiguous.
 */
export function findInlineBlock(
  note: string,
  source: string,
  hint?: BlockRange,
): BlockRange | null {
  const lines = note.split("\n");
  const matches = (r: BlockRange): boolean =>
    r.lineStart >= 0 &&
    r.lineEnd < lines.length &&
    r.lineEnd > r.lineStart &&
    FENCE_OPEN.test(lines[r.lineStart]) &&
    lines.slice(r.lineStart + 1, r.lineEnd).join("\n") === source;

  if (hint && matches(hint)) return hint;
  const found = inlineBlockRanges(note).filter(matches);
  return found.length === 1 ? found[0] : null;
}

/**
 * Like `findInlineBlock`, but when no block's text matches exactly, fall back
 * to the block holding the same stroke payload (`v<n>:` line) — its caption
 * may have changed meanwhile (e.g. a background transcription of an earlier
 * editing session landed). Still refuses ambiguity: identical drawings
 * resolve only through `hint`.
 */
export function locateInlineBlock(
  note: string,
  source: string,
  hint?: BlockRange,
): BlockRange | null {
  const exact = findInlineBlock(note, source, hint);
  if (exact) return exact;
  const payload = parseInlineBlock(source).payload;
  if (!payload) return null;
  const found = inlineBlockRanges(note).filter(
    (r) => parseInlineBlock(blockInner(note, r)).payload === payload,
  );
  const atHint =
    hint && found.find((r) => r.lineStart === hint.lineStart && r.lineEnd === hint.lineEnd);
  if (atHint) return atHint;
  return found.length === 1 ? found[0] : null;
}

/**
 * Rewrite the inner text of the fenced block at `range` (fences kept as-is).
 */
export function replaceInlineBlock(note: string, range: BlockRange, inner: string): string {
  const lines = note.split("\n");
  lines.splice(range.lineStart + 1, range.lineEnd - range.lineStart - 1, ...inner.split("\n"));
  return lines.join("\n");
}

/**
 * Character offsets `[start, end)` that delete the block at `range` from
 * `note`: the fences and everything between, plus one blank line next to it
 * when the block sat between blank lines (or ended the note after one), so no
 * double blank line is left behind.
 */
export function inlineBlockRemoval(
  note: string,
  range: BlockRange,
): { start: number; end: number } {
  const lines = note.split("\n");
  const offset = (line: number): number => {
    let at = 0;
    for (let i = 0; i < line; i++) at += lines[i].length + 1;
    return at;
  };
  const blankBefore = range.lineStart > 0 && lines[range.lineStart - 1].trim() === "";
  // A trailing newline splits into a final "" — that is the note's end, not a line.
  const lineCount = note.endsWith("\n") ? lines.length - 1 : lines.length;
  const after = range.lineEnd + 1;

  if (after < lineCount) {
    const blankAfter = lines[after].trim() === "";
    const end = blankAfter && (range.lineStart === 0 || blankBefore) ? after + 1 : after;
    return { start: offset(range.lineStart), end: offset(end) };
  }
  // The block ends the note.
  if (note.endsWith("\n")) {
    const start = blankBefore ? offset(range.lineStart - 1) : offset(range.lineStart);
    return { start, end: note.length };
  }
  // No final newline: take the line break before the block instead.
  const start = range.lineStart > 0 ? offset(range.lineStart) - 1 : 0;
  return { start, end: note.length };
}

/** `note` without the block at `range` (see `inlineBlockRemoval`). */
export function removeInlineBlock(note: string, range: BlockRange): string {
  const { start, end } = inlineBlockRemoval(note, range);
  return note.slice(0, start) + note.slice(end);
}
