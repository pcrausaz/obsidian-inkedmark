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

### P1 — `![[*.ink.md]]` embed inconsistent across reading vs live preview

- **Seen:** the inline file-embed renders the ink in live preview but shows an
  empty/blank area in reading mode (only the title link appears).
- **Cause:** our markdown post-processor races Obsidian's async embed load; in
  reading mode Obsidian re-populates the `.internal-embed` after we render,
  overwriting our canvas.
- **Fix (0.5 polish):** use a `MutationObserver`/`MarkdownRenderChild` on the
  embed and re-render when Obsidian finishes loading it, or hook the embed
  more robustly (Excalidraw-style). Track back-navigation UX too: opening the
  ink note from an embed should leave an obvious way back (Obsidian back arrow).

## Fixed

### P1 — Text-layer panel exposed YAML frontmatter ✅

- The transcription textarea showed the note's frontmatter. Now the panel edits
  **prose only** (`splitFrontmatter` in `serialize.ts`); frontmatter is kept
  aside and recombined verbatim on save.
