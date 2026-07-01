/**
 * Reading-mode rendering of inline ```inkedmark``` blocks (§4.2, §15 phase 0.3).
 *
 * Registers a markdown code-block processor that decodes the stroke payload and
 * paints it read-only onto a static, DPR-aware canvas (via the same
 * perfect-freehand outline path the live renderer uses). Live-preview editing of
 * these blocks is Phase 0.4; here they are display-only.
 *
 * `![[*.ink.md]]` embeds are handled by Obsidian's normal file-embed machinery
 * (the file is real markdown) and need no code here.
 */

import type { MarkdownPostProcessorContext, Plugin } from "obsidian";
import { DEFAULT_HIGHLIGHTER_ALPHA, INK_FILE_SUFFIX } from "../constants";
import { outlineToSvgPath, penOptions, strokeOutline } from "../ink/freehand";
import { type Bounds, type InkDocument, documentBounds } from "../model/document";
import { parseInlineBlock } from "../model/inline-block";
import { SerializeError, decodeDocument, parseInkFile } from "../model/serialize";

const MAX_DPR = 3;
const PAD = 6;

export function registerInkEmbeds(plugin: Plugin): void {
  // ```inkedmark``` fenced blocks.
  plugin.registerMarkdownCodeBlockProcessor("inkedmark", (source, el) => {
    renderInlineBlock(source, el);
  });
  // ![[*.ink.md]] file embeds -> render the referenced note's ink inline.
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    void renderFileEmbeds(plugin, el, ctx);
  });
}

async function renderFileEmbeds(
  plugin: Plugin,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): Promise<void> {
  const embeds = el.querySelectorAll<HTMLElement>(".internal-embed");
  for (const embed of Array.from(embeds)) {
    if (embed.hasClass("inkedmark-fileembed")) continue;
    const src = embed.getAttribute("src");
    if (!src) continue;
    const file = plugin.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
    if (!file || !file.name.endsWith(INK_FILE_SUFFIX)) continue;

    embed.addClass("inkedmark-fileembed");
    embed.empty();
    embed.createEl("a", {
      cls: "inkedmark-embed-title internal-link",
      text: file.basename,
      href: file.path,
    });
    try {
      const { doc } = parseInkFile(await plugin.app.vault.cachedRead(file));
      const bounds = doc ? documentBounds(doc) : null;
      if (doc && bounds) drawStatic(embed, doc, bounds);
      else embed.createDiv({ cls: "inkedmark-embed-empty", text: "No handwriting yet" });
    } catch {
      embed.createDiv({ cls: "inkedmark-embed-empty", text: "Could not load handwriting" });
    }
  }
}

function renderInlineBlock(source: string, el: HTMLElement): void {
  const container = el.createDiv({ cls: "inkedmark-embed" });
  const { caption, payload } = parseInlineBlock(source);

  if (!payload) {
    container.createDiv({ cls: "inkedmark-embed-empty", text: "Empty handwriting block" });
  } else {
    let doc: InkDocument | null = null;
    try {
      doc = decodeDocument(payload);
    } catch (error) {
      if (!(error instanceof SerializeError)) throw error;
    }
    const bounds = doc ? documentBounds(doc) : null;
    if (doc && bounds) {
      drawStatic(container, doc, bounds);
    } else {
      container.createDiv({
        cls: "inkedmark-embed-empty",
        text: doc ? "Empty handwriting block" : "Unreadable handwriting block",
      });
    }
  }

  if (caption) container.createDiv({ cls: "inkedmark-embed-caption", text: caption });
}

function drawStatic(container: HTMLElement, doc: InkDocument, bounds: Bounds): void {
  const worldW = bounds.maxX - bounds.minX + PAD * 2;
  const worldH = bounds.maxY - bounds.minY + PAD * 2;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  const canvas = container.createEl("canvas", { cls: "inkedmark-embed-canvas" });
  canvas.width = Math.max(1, Math.round(worldW * dpr));
  canvas.height = Math.max(1, Math.round(worldH * dpr));
  canvas.style.width = `${Math.round(worldW)}px`;
  canvas.style.maxWidth = "100%";
  canvas.style.height = "auto";

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, (-bounds.minX + PAD) * dpr, (-bounds.minY + PAD) * dpr);

  for (const region of doc.regions) {
    for (const stroke of region.strokes) {
      const outline = strokeOutline(stroke.pts, penOptions(stroke.size, true), true);
      const path = outlineToSvgPath(outline);
      if (!path) continue;
      ctx.save();
      if (stroke.tool === "highlighter") {
        ctx.globalAlpha = DEFAULT_HIGHLIGHTER_ALPHA;
        ctx.globalCompositeOperation = "multiply";
      }
      ctx.fillStyle = stroke.color;
      ctx.fill(new Path2D(path));
      ctx.restore();
    }
  }
}
