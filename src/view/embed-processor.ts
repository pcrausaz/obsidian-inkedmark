/**
 * Inline rendering of handwriting in ordinary notes (§4.2, §15 phase 0.3/0.4).
 *
 * - ```inkedmark``` fenced blocks: a code-block processor decodes the payload and
 *   paints it onto a static, DPR-aware canvas, with a corner button that opens
 *   the block in `InlineInkModal`; on close the new strokes are written back
 *   into the fenced block (located via `getSectionInfo`, with a content-based
 *   fallback when the note moved underneath the render). Obsidian runs
 *   code-block processors in BOTH reading mode and Live Preview (when the block
 *   isn't being edited), so this covers both — pen input in place would fight
 *   the page's scrolling and be torn down on every file change.
 * - `![[*.ink.md]]` file embeds: a post-processor renders the referenced note's
 *   ink inline. Obsidian populates embeds asynchronously and can clobber our
 *   render in reading mode, so we re-paint via a bounded MutationObserver.
 */

import {
  MarkdownRenderChild,
  type MarkdownPostProcessorContext,
  Notice,
  type Plugin,
  type TFile,
  setIcon,
} from "obsidian";
import { DEFAULT_HIGHLIGHTER_ALPHA, INK_FILE_SUFFIX } from "../constants";
import { resolveInkColor } from "../canvas/ink-color";
import { outlineToSvgPath, penOptions, strokeOutline } from "../ink/freehand";
import { type Bounds, type InkDocument, documentBounds, emptyDocument } from "../model/document";
import {
  findInlineBlock,
  parseInlineBlock,
  replaceInlineBlock,
  updateInlineBlockPayload,
} from "../model/inline-block";
import { SerializeError, decodeDocument, encodeDocument, parseInkFile } from "../model/serialize";
import { InlineInkModal } from "./inline-ink-modal";
import type InkedMarkPlugin from "../main";

const MAX_DPR = 3;
const PAD = 6;
const MAX_REPAINTS = 5;

export function registerInkEmbeds(plugin: InkedMarkPlugin): void {
  // ```inkedmark``` fenced blocks (renders in reading mode AND live preview).
  plugin.registerMarkdownCodeBlockProcessor("inkedmark", (source, el, ctx) => {
    renderInlineBlock(plugin, source, el, ctx);
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

function renderInlineBlock(
  plugin: InkedMarkPlugin,
  source: string,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  const container = el.createDiv({ cls: "inkedmark-embed inkedmark-embed-editable" });
  const { caption, payload } = parseInlineBlock(source);

  let doc: InkDocument | null = null;
  let unreadable = false;
  if (payload) {
    try {
      doc = decodeDocument(payload);
    } catch (error) {
      if (!(error instanceof SerializeError)) throw error;
      unreadable = true;
    }
  }
  const bounds = doc ? documentBounds(doc) : null;
  if (doc && bounds) {
    drawStatic(container, doc, bounds);
  } else {
    container.createDiv({
      cls: "inkedmark-embed-empty",
      text: unreadable
        ? "Unreadable handwriting block"
        : "Empty handwriting block — tap the corner icon to draw",
    });
  }
  if (caption) container.createDiv({ cls: "inkedmark-embed-caption", text: caption });

  // An unreadable payload is never overwritten: editing would replace ink we
  // failed to decode. The user can still fix or delete the block in source.
  if (unreadable) return;
  // Same affordance as Obsidian's own file embeds (the corner "open" arrows).
  const edit = container.createEl("button", { cls: "inkedmark-embed-edit clickable-icon" });
  setIcon(edit, "maximize-2");
  edit.setAttribute("aria-label", "Edit handwriting");
  // Keep the press inside the widget: in Live Preview a press that reaches
  // CodeMirror moves the cursor into the block and unmounts this render before
  // `click` fires (mouse on desktop, touch/pointer on mobile).
  for (const type of ["mousedown", "pointerdown", "touchstart", "touchend"] as const) {
    edit.addEventListener(type, (event) => event.stopPropagation());
  }
  edit.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      // Re-decode for the editor so a cancelled session can't leave the rendered
      // (shared) document mutated.
      let editDoc: InkDocument;
      try {
        editDoc = payload ? decodeDocument(payload) : emptyDocument(plugin.settings.paperWidth);
      } catch {
        editDoc = emptyDocument(plugin.settings.paperWidth);
      }
      // Capture the section position now: after the modal closes the element may
      // already be detached (Live Preview re-renders eagerly).
      const info = ctx.getSectionInfo(el);
      const hint = info ? { lineStart: info.lineStart, lineEnd: info.lineEnd } : undefined;
      new InlineInkModal(plugin.app, plugin.settings, editDoc, (edited) => {
        void writeInlineBlock(plugin, ctx.sourcePath, source, hint, edited);
      }).open();
    } catch (error) {
      // Mobile has no console within reach; make a failure visible.
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`InkedMark: couldn't open the handwriting editor — ${message}`, 8000);
    }
  });
}

/** Persist an edited inline block: replace its payload line inside the fenced block. */
async function writeInlineBlock(
  plugin: InkedMarkPlugin,
  sourcePath: string,
  source: string,
  hint: { lineStart: number; lineEnd: number } | undefined,
  doc: InkDocument,
): Promise<void> {
  const file = plugin.app.vault.getFileByPath(sourcePath);
  if (!file) {
    new Notice("InkedMark: couldn't save — the note is no longer available.");
    return;
  }
  const inner = updateInlineBlockPayload(source, encodeDocument(doc));
  let written = false;
  await plugin.app.vault.process(file, (data) => {
    const range = findInlineBlock(data, source, hint);
    if (!range) return data;
    written = true;
    return replaceInlineBlock(data, range, inner);
  });
  if (!written) {
    new Notice(
      "InkedMark: couldn't find the handwriting block in the note (was it edited meanwhile?). " +
        "Your drawing was not saved.",
      8000,
    );
  }
}

function drawStatic(container: HTMLElement, doc: InkDocument, bounds: Bounds): void {
  const worldW = bounds.maxX - bounds.minX + PAD * 2;
  const worldH = bounds.maxY - bounds.minY + PAD * 2;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  const canvas = container.createEl("canvas", { cls: "inkedmark-embed-canvas" });
  canvas.width = Math.max(1, Math.round(worldW * dpr));
  canvas.height = Math.max(1, Math.round(worldH * dpr));
  canvas.setCssStyles({ width: `${Math.round(worldW)}px` });

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
      ctx.fillStyle = resolveInkColor(
        stroke.color,
        activeDocument.body.classList.contains("theme-dark"),
      );
      ctx.fill(new Path2D(path));
      ctx.restore();
    }
  }
}
