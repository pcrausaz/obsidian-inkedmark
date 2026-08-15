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
 * Return `source` with its stroke payload replaced by `payload`, keeping every
 * other line (caption, unknown lines) verbatim. Without an existing payload
 * line the payload is appended.
 */
export function updateInlineBlockPayload(source: string, payload: string): string {
  const lines = source.split(/\r?\n/);
  const at = lines.findIndex((line) => /^v\d+:/.test(line.trim()));
  if (at >= 0) {
    lines[at] = payload;
  } else {
    // Drop a single trailing blank line so the payload sits inside the block.
    if (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(payload);
  }
  return lines.join("\n");
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*inkedmark\b/;

/** Line range (0-based, inclusive) of a fenced ```inkedmark``` block, fences included. */
export interface BlockRange {
  lineStart: number;
  lineEnd: number;
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

  const found: BlockRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) continue;
    const fence = open[1];
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.startsWith(fence[0].repeat(fence.length)) && /^[`~]+\s*$/.test(t)) {
        const range = { lineStart: i, lineEnd: j };
        if (matches(range)) found.push(range);
        i = j;
        break;
      }
    }
  }
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
