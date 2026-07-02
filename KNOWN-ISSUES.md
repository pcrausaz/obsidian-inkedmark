# Known issues / tracked bugs

From on-device QA (iPad Pro 12.9″ 4th-gen). Severity: P0 (blocks) → P2 (polish).
See `QA.md` for the test pass that surfaced these.

## Open

### P1 — Intermittent stray straight strokes under load

- **Seen:** after ~88 strokes, a few long straight lines appeared that the user
  did not intentionally draw. Not reproducible on demand.
- **Hypothesis:** WebKit dropping intermediate `pointermove` events under
  main-thread load, so a real stroke commits as a 2-point straight segment
  (down→up). Less likely: a rare pointer event-ordering glitch in the
  stale-stroke finalize path (`input/pointer-controller.ts`).
- **Next:** reproduce with the input HUD on and capture the event trace
  (watch `gap=` spikes and the `dn/up` sequence). If it is dropped-moves,
  mitigation is further main-thread reduction; if it is the finalize path,
  guard the transition. Do NOT filter "straight" strokes — that would delete
  legitimate ruled lines.

## Fixed

### P1 — `![[*.ink.md]]` embed blank in reading mode (async race) ✅

- The file-embed post-processor raced Obsidian's async embed population; in
  reading mode Obsidian repopulated the `.internal-embed` after our render,
  blanking the ink.
- **Fix:** `mountFileEmbed` re-paints via a bounded `MutationObserver`
  (`MAX_REPAINTS`), disconnecting during its own writes and on unload via a
  `MarkdownRenderChild`. Needs an on-device re-check in reading mode.

### P1 — Back arrow from an ink note didn't return to the embedding note ✅

- Navigation history contained an intermediate "ink file as markdown" state
  (the `%%inkedmark%%` flash); the layout-change auto-switcher instantly
  flipped it back to the ink view, eating the Back press.
- **Fix:** patch `WorkspaceLeaf.setViewState` (the Kanban/Excalidraw approach)
  so ink files instantiate directly as the ink view — no markdown state ever
  enters history. Original method restored on plugin unload.

### P1 — Deleting all strokes left a stale transcription ✅

- The managed `<!--inkedmark-text-->` section persisted after clearing the ink.
- **Fix:** the trash/clear action now also clears the managed section (user
  prose untouched), and any recognition run on an empty page removes it.
  Recognition is also skipped entirely when the ink content hash is unchanged
  since the last run.

### P1 — Text-layer panel exposed YAML frontmatter ✅

- The transcription textarea showed the note's frontmatter. Now the panel edits
  **prose only** (`splitFrontmatter` in `serialize.ts`); frontmatter is kept
  aside and recombined verbatim on save.
