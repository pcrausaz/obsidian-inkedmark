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
