/**
 * Inline rendering of handwriting in ordinary notes (§4.2, §15 phase 0.3/0.4).
 *
 * - ```inkedmark``` fenced blocks: a code-block processor decodes the payload and
 *   paints it read-only onto a static, DPR-aware canvas. Obsidian runs code-block
 *   processors in BOTH reading mode and Live Preview (when the block isn't being
 *   edited), so this already covers live preview — a separate CM6 widget would be
 *   redundant and risk breaking source editing. Interactive inline drawing stays
 *   in dedicated `.ink.md` notes.
 * - `![[*.ink.md]]` file embeds: a post-processor renders the referenced note's
 *   ink inline. Obsidian populates embeds asynchronously and can clobber our
 *   render in reading mode, so we re-paint via a bounded MutationObserver.
 */

import {
  MarkdownRenderChild,
  type MarkdownPostProcessorContext,
  type Plugin,
  type TFile,
} from "obsidian";
import { DEFAULT_HIGHLIGHTER_ALPHA, INK_FILE_SUFFIX } from "../constants";
import { resolveInkColor } from "../canvas/ink-color";
import { outlineToSvgPath, penOptions, strokeOutline } from "../ink/freehand";
import { type Bounds, type InkDocument, documentBounds } from "../model/document";
import { parseInlineBlock } from "../model/inline-block";
import { SerializeError, decodeDocument, parseInkFile } from "../model/serialize";

const MAX_DPR = 3;
const PAD = 6;
const MAX_REPAINTS = 5;

export function registerInkEmbeds(plugin: Plugin): void {
  // ```inkedmark``` fenced blocks (renders in reading mode AND live preview).
  plugin.registerMarkdownCodeBlockProcessor("inkedmark", (source, el) => {
    renderInlineBlock(source, el);
  });
  // ![[*.ink.md]] file embeds -> render the referenced note's ink inline.
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    for (const embed of Array.from(el.querySelectorAll<HTMLElement>(".internal-embed"))) {
      if (embed.hasClass("inkedmark-fileembed")) continue;
      const src = embed.getAttribute("src");
      if (!src) continue;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (!file || !file.name.endsWith(INK_FILE_SUFFIX)) continue;
      embed.addClass("inkedmark-fileembed");
      mountFileEmbed(plugin, embed, file, ctx);
    }
  });
}

/**
 * Paint the referenced note's ink into `embed`, and keep it painted: Obsidian
 * repopulates embeds asynchronously (especially in reading mode), so a bounded
 * MutationObserver re-paints if our content is clobbered. Tied to the render
 * lifecycle via a MarkdownRenderChild so the observer is disconnected on unload.
 */
function mountFileEmbed(
  plugin: Plugin,
  embed: HTMLElement,
  file: TFile,
  ctx: MarkdownPostProcessorContext,
): void {
  let repaints = 0;
  const observer = new MutationObserver(() => {
    if (repaints >= MAX_REPAINTS) {
      observer.disconnect();
      return;
    }
    if (!embed.querySelector(".inkedmark-embed-title")) {
      repaints++;
      void paint();
    }
  });

  const paint = async (): Promise<void> => {
    observer.disconnect();
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
    observer.observe(embed, { childList: true });
  };

  const child = new MarkdownRenderChild(embed);
  child.onunload = () => observer.disconnect();
  ctx.addChild(child);
  void paint();
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
      ctx.fillStyle = resolveInkColor(stroke.color, document.body.classList.contains("theme-dark"));
      ctx.fill(new Path2D(path));
      ctx.restore();
    }
  }
}
