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
  type Editor,
  MarkdownRenderChild,
  type MarkdownPostProcessorContext,
  MarkdownView,
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
  type BlockRange,
  blockInner,
  locateInlineBlock,
  parseInlineBlock,
  replaceInlineBlock,
  updateInlineBlockSource,
} from "../model/inline-block";
import { SerializeError, decodeDocument, encodeDocument, parseInkFile } from "../model/serialize";
import { InlineInkModal, type InlineInkResult } from "./inline-ink-modal";
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
      new InlineInkModal(
        plugin,
        editDoc,
        caption,
        inlineBlockSaver(plugin, ctx.sourcePath, source, hint),
      ).open();
    } catch (error) {
      // Mobile has no console within reach; make a failure visible.
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`InkedMark: couldn't open the handwriting editor — ${message}`, 8000);
    }
  });
}

/**
 * Save callback for one editing session of an inline block. A session can
 * save more than once — the ink when the editor closes, then the caption when
 * a transcription still running at close time lands (issue #29) — so the
 * saver remembers what it last wrote to find the block again, and chains
 * writes so they never interleave.
 *
 * With `editor` (a block just inserted by the command), writes go through that
 * editor's buffer while its note is still open — the file on disk may lag it.
 * Otherwise, or once that note is closed, the file at `sourcePath` is
 * rewritten directly. A null `sourcePath` (an editor that isn't a note view)
 * always writes through `editor`.
 */
export function inlineBlockSaver(
  plugin: InkedMarkPlugin,
  sourcePath: string | null,
  source: string,
  hint: BlockRange | undefined,
  editor?: Editor,
): (result: InlineInkResult) => void {
  let current = source;
  let currentHint = hint;
  let chain: Promise<void> = Promise.resolve();
  return (result) => {
    chain = chain.then(async () => {
      const payload = encodeDocument(result.doc);
      // Merge into the block as it is now: a caption the session didn't touch
      // (`null`) keeps whatever the note holds.
      const update = (inner: string): string =>
        updateInlineBlockSource(inner, payload, result.caption);
      const written =
        editor && (sourcePath === null || editorStillOpen(plugin, editor, sourcePath))
          ? writeViaEditor(editor, current, currentHint, update)
          : sourcePath !== null
            ? await writeViaFile(plugin, sourcePath, current, currentHint, update)
            : null;
      if (!written) {
        new Notice(
          "InkedMark: couldn't find the handwriting block in the note (was it edited meanwhile?). " +
            "Your drawing was not saved.",
          8000,
        );
        return;
      }
      current = written.inner;
      currentHint = {
        lineStart: written.lineStart,
        lineEnd: written.lineStart + written.inner.split("\n").length + 1,
      };
    });
  };
}

interface Written {
  lineStart: number;
  inner: string;
}

function editorStillOpen(plugin: InkedMarkPlugin, editor: Editor, sourcePath: string): boolean {
  return plugin.app.workspace
    .getLeavesOfType("markdown")
    .some(
      (leaf) =>
        leaf.view instanceof MarkdownView &&
        leaf.view.editor === editor &&
        leaf.view.file?.path === sourcePath,
    );
}

function writeViaEditor(
  editor: Editor,
  source: string,
  hint: BlockRange | undefined,
  update: (inner: string) => string,
): Written | null {
  const text = editor.getValue();
  const range = locateInlineBlock(text, source, hint);
  if (!range) return null;
  const inner = update(blockInner(text, range));
  editor.replaceRange(
    inner + "\n",
    { line: range.lineStart + 1, ch: 0 },
    { line: range.lineEnd, ch: 0 },
  );
  return { lineStart: range.lineStart, inner };
}

async function writeViaFile(
  plugin: InkedMarkPlugin,
  sourcePath: string,
  source: string,
  hint: BlockRange | undefined,
  update: (inner: string) => string,
): Promise<Written | null> {
  const file = plugin.app.vault.getFileByPath(sourcePath);
  if (!file) return null;
  let written: Written | null = null;
  await plugin.app.vault.process(file, (data) => {
    const range = locateInlineBlock(data, source, hint);
    if (!range) return data;
    const inner = update(blockInner(data, range));
    written = { lineStart: range.lineStart, inner };
    return replaceInlineBlock(data, range, inner);
  });
  return written;
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
