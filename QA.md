# InkedMark — on-device QA checklist

Manual test pass for the Obsidian iPad app (the priority surface). Unit tests
cover pure logic; this covers the gesture / coordinate / rendering integration
that only a real device + Apple Pencil exercises. Re-run the relevant sections
after any change to input, rendering, layout, or gestures.

## Setup (do first)

- [ ] **iPad Settings → Apple Pencil → Scribble is OFF.** (With it on, fast
      strokes are dropped before the web view sees them — see README.)
- [ ] Build deployed and synced: run `npm run build` (or `npm run dev`), wait
      for iCloud, reload Obsidian (**"Reload app without saving"**).
- [ ] **Confirm the build id** in the toolbar's right-hand readout matches the
      one printed by the build (`vX.Y.Z · YYYYMMDD-HHMMSS · N strokes · 100%`).
      Do not trust any result until the id matches.
- [ ] Enable the HUD (command: **"Toggle input debug overlay"**) for the capture
      tests; disable it afterward.

Tested devices (append as you go): iPad Pro 12.9″ 4th-gen (A12Z, Pencil 2) — 0.1 ✅.

---

## P0 — Ink capture regression (the whole premise)

- [ ] Write "This is a test" at **normal/fast speed**. Every stroke lands; no
      missing letters or in-letter strokes. (HUD: `Σ dn` == strokes you made.)
- [ ] `gap=` on the HUD stays low (< ~30ms) during a stroke; no long stalls.
- [ ] Ink is visible **during** the stroke and **persists on pen-up** (no
      vanish / torn fragments).
- [ ] A quick tap makes a dot.
- [ ] Latency feels acceptable (wet ink tracks the nib). Toggle Settings →
      **Desynchronized canvas** off/on and note any difference.
- [ ] Fill a page (many strokes) and keep writing — capture does **not** degrade
      as the note grows.

## P0 — Gestures (highest device risk)

- [ ] **Palm rejection:** rest your palm while writing — palm touches do not draw
      or scroll; only the Pencil draws.
- [ ] **One finger pans** (scrolls) the paper vertically; the Pencil still draws.
- [ ] **Two-finger pinch zooms**; the point under your fingers stays put
      (zoom-to-point is correct, not drifting). Zoom % updates in the readout.
- [ ] **Two-finger drag pans** while zoomed (both axes; horizontal scroll works
      when zoomed in past the width).
- [ ] A Pencil-down **mid-pinch** cancels the gesture and starts drawing.
- [ ] Zoom out below 100% centers the page; zoom in shows horizontal scroll.
- [ ] Toolbar zoom −/fit/+ and the Zoom in/out/Fit commands agree with pinch.

## P1 — Tools & editing (verify at 100% AND while zoomed)

- [ ] Pen (`P`) and Highlighter (`H`) draw; highlighter is translucent /
      multiplies; color + size swatches apply; pressure toggle changes width.
- [ ] **Eraser** (`E`): dragging over strokes removes exactly those touched
      (hit radius feels right); preview disappears live; works at zoom ≠ 1.
- [ ] **Select** (`V`): marquee selects intersecting strokes (dashed box shown);
      drag inside the box **moves** them; move is accurate at zoom ≠ 1.
- [ ] `Delete`/`Backspace` removes the selection; switching tools clears it.
- [ ] **Undo/redo** (buttons + `⌘Z`/`⌘⇧Z`): draw, erase, move, delete, clear all
      undo to the exact prior state and redo forward; redo clears after a new edit.
- [ ] Clear (trash) removes all ink and is undoable.
- [ ] Default ink color is visible on the current theme (white on dark).

## P1 — Persistence

- [ ] Draw, wait a moment, **close and reopen** the note — ink is exactly as left.
- [ ] Reopen after an app restart / from another synced device — ink intact.
- [ ] Open the `.ink.md` as **markdown** (Toggle canvas/markdown view) — the
      `%%inkedmark … %%` block is present and the body prose is untouched.

## P1 — Text layer (0.3)

- [ ] Toolbar text-layer toggle (and command) shows/hides the panel.
- [ ] Type transcription with `[[a link]]` and `#tag`; close/reopen — text
      persists in the body; ink is unaffected.
- [ ] The note is found by **core Search** for words typed in the text layer.
- [ ] `[[links]]`/`#tags` from the text layer appear in **graph / backlinks**;
      the note shows in **Quick Switcher** and has working **Properties** (tags).

## P1 — Inline embeds, reading mode (0.3)

- [ ] In a normal note, `![[Sketch.ink.md]]` renders the sketch inline (title +
      ink), fitting the note width; opening the link opens the ink note.
- [ ] **"Insert inline handwriting"** inserts a ` ```inkedmark ` block;
      in reading mode a block with strokes renders the ink; an empty one shows a
      placeholder; a `caption:` line renders below.
- [ ] A corrupt payload shows "Unreadable…", not a crash.

## P2 — Cross-cutting

- [ ] Light and dark themes both legible (ink, paper, toolbar, selection box).
- [ ] Rotate the iPad / split view — canvas resizes, ink stays aligned, no blur.
- [ ] Ribbon icon and **"Create handwriting note"** make a new `.ink.md` and open
      it in the ink view; opening an existing `.ink.md` switches to the ink view.
- [ ] Keyboard shortcuts don't fire while typing in the text-layer textarea.
- [ ] Desktop sanity (mouse draws, wheel scrolls, no console errors).

## Known-risk watchlist (things that have surprised us on WebKit)

- Dropped `pointerup` on fast pen lifts → stale-stroke finalize should recover.
- Desynchronized canvas dropping the dry buffer → dry layer is synchronized.
- `touch-action` hijacking the pen as scroll → surface is `touch-action: none`.
- Pinch **zoom-to-point sign**: if content drifts away from the fingers while
  zooming, the scroll-correction sign in `applyZoom` is inverted — flip
  `anchorScrollDelta`'s sign.
- iCloud sync lag making a stale build look like a bug → always confirm build id.
