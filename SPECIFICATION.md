# InkedMark — Technical Specification

> Handwriting that lives inside your Obsidian notes — pressure-aware ink, fused
> with markdown, searchable and graphable like everything else in your vault.

- **Plugin name:** InkedMark
- **Plugin id:** `inkedmark`
- **Repo:** `obsidian-inkedmark` (GitHub: `pcrausaz/obsidian-inkedmark`)
- **Website:** inkedmark.com (GitHub Pages)
- **License:** MIT (© 2026 Pascal Crausaz)
- **Status:** greenfield — this document is the build brief.

This spec is the single source of truth for a fresh codebase. It is written to
be handed to a new Claude Code session (see §16). It is precise on purpose:
file layout, data formats, interfaces, tooling, and phasing are all pinned down
so implementation is a matter of execution, not re-litigating decisions.

---

## 1. Vision & problem statement

Obsidian is an outstanding *typed-knowledge* tool — linking, graph, search,
local-first markdown. It is poor at *handwriting*: nothing in it approaches
GoodNotes/Notability for pen-on-paper note-taking. The existing whiteboard
plugins (including the author's prior `obsidian-pencil`) produce **opaque ink
blobs that participate in none of Obsidian's strengths** — no text, no search,
no graph, no mixing with typed notes.

InkedMark's thesis: handwriting should be a **first-class block inside ordinary
markdown notes**, and every handwritten region should carry a **searchable,
graph-indexed text layer**. You write by hand where handwriting is better
(diagrams, math, marginalia, fast capture) and type where typing is better — in
the *same note* — and Obsidian's search/graph see all of it.

### What "best experience" means here (the B-vs-D decision, recorded)

Evaluated against the real requirement — *mix markdown + handwriting, with
native search and graph* — the unit of integration is **Obsidian's markdown
document, not a canvas**. Therefore:

- **Architecture = custom, Obsidian-native ("B").** We own the document model,
  rendering, input, and — critically — the markdown/text-layer integration.
- **Ink rendering = `perfect-freehand` (the one good ingredient of "D").** It
  turns pressure-points into a proper variable-width filled outline; it is the
  same primitive tldraw/Excalidraw use, at ~4KB and zero framework cost.
- **Rejected: forking tldraw or Excalidraw ("heavy D").** Reasons: tldraw's
  license forbids free redistribution without a watermark/commercial terms;
  Excalidraw is a diagram engine (React + scene model) whose freedraw and data
  model fight a text-layer/markdown integration; both add weight and coupling
  for capabilities we don't need (2D infinite diagramming) while making the
  capability we *do* need (clean text layer + inline markdown embeds) harder.

The valuable part of an engine is its ink geometry, and that is a library, not
an engine. We take the library and build the rest to fit Obsidian.

---

## 2. Goals & non-goals

### Goals (what defines success)
1. **GoodNotes-class ink feel** within the webview's ceiling: pressure-variable
   ink via `perfect-freehand`, full-rate capture via coalesced pointer events,
   low latency via a wet/dry canvas split and a desynchronized context.
2. **Mix typed markdown and handwriting in one note** via inline embeds and an
   inline ink code-block.
3. **Searchable & graphable handwriting** through a first-class text layer that
   is real markdown body content (manual transcription in v1; pluggable HWR
   later).
4. **Local-first, single-file, sync-friendly** storage. No network required.
5. **Works on desktop, iPad, and mobile.** iPad/Apple Pencil is the priority
   surface.
6. **Production hygiene:** strict TypeScript, ESLint + Prettier, Vitest unit
   tests, CI + release automation, a Pages website.

### Non-goals (v1 — explicitly out of scope)
- Automatic handwriting recognition (architecture reserves the slot; no engine
  ships in v1 — see §10).
- Full 2D infinite-canvas whiteboarding (an *optional* mode later; not the
  default document model — see §4).
- PDF import/annotation, audio recording, shape/line/text tools, layers.
- A native companion app (deliberately rejected; web/Obsidian only).
- Real-time multi-user collaboration.

---

## 3. Product model

### 3.1 Document model: vertical "paper roll", not 2D canvas
Note-taking flows linearly and must embed in a markdown column. The default
ink surface is therefore a **fixed-width, vertically-growing region** (a paper
roll) — it paginates naturally, scrolls vertically, and embeds inline. A full
2D infinite canvas (free pan/zoom in both axes) is an **optional dedicated mode**
for whiteboard-style use, not the default. Horizontal width tracks the host
container; vertical extent grows with content.

### 3.2 Two ways handwriting appears
1. **Dedicated ink note** — a `*.ink.md` file rendered by InkedMark's custom
   view as a canvas + text-layer. It *is* a markdown file, so Obsidian indexes,
   graphs, links, syncs, and version-controls it natively.
2. **Inline embed in a normal note** — inside any `.md` note:
   - `![[Sketch.ink.md]]` renders the referenced ink note inline (read-only or
     interactive), or
   - a fenced ```` ```inkedmark ```` block holds a small inline annotation drawn
     in place.

   Either way the host note stays markdown; typed text and handwriting coexist.

### 3.3 The text layer (the search/graph unlock)
Every ink note and every embed can carry a **text layer**: human-readable
markdown that lives in the note body. In v1 the user types it (a transcription,
a title, key points, `[[links]]`, `#tags`). It is ordinary markdown, so:
- Obsidian's **search** finds handwritten notes by their text layer.
- The **graph** and **backlinks** connect them through links/tags in that layer.
- Later, an HWR provider can *populate* this layer automatically (§10) with no
  format change.

---

## 4. Data format

### 4.1 Dedicated ink note: `*.ink.md`
A single markdown file. Three parts:

```markdown
---
inkedmark: true
inkedmark-version: 1
created: 2026-06-30T16:50:00Z
modified: 2026-06-30T17:10:00Z
tags: [meeting, project-x]
---

# Project X — kickoff

Typed intro is fine here. Handwriting transcription / key points below feed
search and the graph:

> [!ink] Notes
> Agreed scope with [[Anna]]; ship #q3. Diagram of the pipeline on the right.

%%inkedmark
v1:eJyNk...<base64(deflate(strokeDocJSON))>...==
%%
```

- **Frontmatter** — `inkedmark: true` is the claim flag the plugin uses to
  recognize the file (Excalidraw-style); `inkedmark-version` is the schema
  version; `tags`/timestamps feed Obsidian's indexes.
- **Body markdown** — the **text layer**. Authored by the user (v1) or HWR
  (later). Fully searchable/graphable. The plugin never destroys user prose
  here; it owns only the trailing data block.
- **Data block** — strokes, wrapped in an Obsidian `%% … %%` comment so it does
  not render in reading view. Format: `v1:` + base64(deflate(JSON)). See §4.3.

**Why single-file (not a sibling binary):** atomic sync/versioning, trivial
embeds, portability. The base64 blob is one giant non-word token; Obsidian's
word-boundary search effectively ignores it, so search noise is negligible. A
two-file mode (pristine text + `.inkedmark` binary) is a possible future
setting if real-world search noise proves otherwise (§17).

### 4.2 Inline annotation block (in any `.md` note)
````markdown
```inkedmark
caption: Quick margin sketch
v1:eJy...<base64(deflate(strokeDocJSON))>...
```
````
Rendered inline by a markdown post-processor (reading mode) and a CodeMirror
editor extension (live preview — phased, §15). Optional `caption:` line is the
searchable text for the inline block.

### 4.3 Stroke document (pre-compression JSON)
Compact by construction: **tuple-packed points** and **quantized coordinates**.

```jsonc
{
  "version": 1,
  "view": { "scrollY": 0, "width": 1024, "scale": 1 },
  "regions": [
    {
      "id": "r1",
      "kind": "ink",
      "strokes": [
        {
          "id": "s1",
          "color": "#ffffff",
          "size": 3,
          "tool": "pen",            // "pen" | "highlighter"
          // points: flat tuples [x, y, p]; coords quantized to 0.01 px (stored
          // as integers at scale 100), pressure quantized to 1/255.
          "pts": [12043, 5510, 128,  12090, 5532, 140, /* … */]
        }
      ]
    }
  ]
}
```

- **Quantization:** x/y stored as `round(coord * 100)` integers; pressure as
  `round(p * 255)`. Reconstituted on load. ~10× smaller than the prior
  pretty-printed `{x,y,p}` objects, before deflate.
- **Compression:** `fflate` deflate → base64. Round-trip must be lossless
  modulo quantization (unit-tested, §13).
- **Forward-compat:** unknown fields preserved on load/save where feasible;
  `version` gates migrations in `model/serialize.ts`.
- **v2 optimization (noted, not built):** columnar + delta-varint point
  encoding for a further ~2–3× before deflate.

---

## 5. Architecture & module layout

Strict separation of **pure logic** (unit-testable, no DOM) from **view/IO**
(thin, manually tested). This is the explicit fix for the prior plugin's
1,100-line god-object `view.ts`.

```
src/
  main.ts                  # InkedMarkPlugin: onload/onunload, register view +
                           #   .ink.md handling, commands, markdown processors,
                           #   settings tab.
  constants.ts             # ids, FILE flag, palette, sizes, zoom bounds.
  settings.ts              # InkedMarkSettings, defaults, SettingTab.

  model/                   # PURE. no DOM, no Obsidian.
    document.ts            #   InkDocument, Region, Stroke, Point types + helpers.
    serialize.ts           #   encode/decode block <-> InkDocument; quantization;
                           #   version migrations.
    compress.ts            #   fflate deflate/inflate + base64 (lossless).
    commands.ts            #   Command pattern: AddStroke, EraseStrokes,
                           #   MoveStrokes, RemoveStrokes, ClearRegion — each with
                           #   apply()/invert().
    history.ts             #   UndoStack of Commands (delta-based, not snapshots).

  ink/                     # PURE.
    freehand.ts            #   perfect-freehand wrapper -> Path2D outline; options
                           #   (size, thinning, smoothing, streamline, caps).
    stroke-builder.ts      #   live wet-stroke assembly from input samples:
                           #   decimation, min-distance, pressure mapping.

  canvas/
    viewport.ts            # PURE-ish: scroll/zoom transform, screen<->world.
    spatial-index.ts       # PURE: uniform grid (or quadtree) for hit-test+cull.
    hit-test.ts            # PURE: stroke hit, rect intersect, bounds.
    renderer.ts            # DOM: dry-layer (committed strokes, rAF, culled,
                           #   static cache) + wet-layer (in-progress stroke +
                           #   selection, drawn synchronously for low latency);
                           #   DPR-aware; getContext('2d',{desynchronized:true}).

  input/
    pointer-controller.ts  # pointer events, getCoalescedEvents/getPredictedEvents,
                           #   gesture routing, capture.
    palm-rejection.ts      # PURE state machine: pen vs touch arbitration.
    tools/
      pen.ts  eraser.ts  selection.ts  pan.ts   # tool strategies.

  recognition/
    provider.ts            # RecognitionProvider interface (§10).
    manual.ts              # default no-op provider (v1).
    text-layer.ts          # PURE: sync rules between region text and md body.

  view/
    ink-view.ts            # TextFileView for *.ink.md: canvas + text panel,
                           #   toolbar, save/load wiring.
    embed-processor.ts     # markdown post-processor: ![[*.ink.md]] embeds and
                           #   ```inkedmark``` blocks.
    toolbar.ts             # toolbar DOM, reused by view and embeds.
  ui/
    confirm-modal.ts       # async confirm (replaces blocking confirm()).
  icons.ts                 # bundled Lucide SVGs via addIcon (mobile-safe).
```

### 5.1 Rendering pipeline
- **Two canvases:** *dry* (committed strokes; repainted on `requestAnimationFrame`,
  viewport-culled via the spatial index, with an optional cached static bitmap
  for unchanged content) and *wet* (the in-progress stroke + selection marquee;
  drawn **synchronously** on each input sample to minimize perceived latency).
- Each committed stroke → a `perfect-freehand` outline → a `Path2D` filled in
  the stroke color. Highlighter = same path with reduced alpha + `multiply`
  blend.
- `getContext('2d', { desynchronized: true })` (validated per platform; fall
  back gracefully). DPR-aware sizing.
- **Culling:** only draw strokes whose bounds intersect the viewport.

### 5.2 Input pipeline
- Pointer Events for pen/touch/mouse. On `pointermove`, expand
  `event.getCoalescedEvents()` to capture full Apple-Pencil sample rate; use
  `getPredictedEvents()` (where supported) to draw the wet stroke ahead of
  commit for latency compensation (predicted points are discarded on commit).
- **Pressure:** `e.pressure` for pen when enabled; constant otherwise. Tilt
  (`tiltX/tiltY`) captured into points for future tilt-shading (stored if
  present; unused in v1 rendering).
- **Palm rejection** (`input/palm-rejection.ts`, pure state machine): once a pen
  is seen, single-finger touches pan and finger input never draws while a pen is
  down; ≥2 touches = pinch-zoom. A pen going down mid-gesture cancels any
  in-progress finger pan/pinch/stroke.

### 5.3 Undo/redo (delta-based)
Command pattern (`model/commands.ts` + `history.ts`). Each user action pushes a
`Command` with `apply()`/`invert()`. **No full-document snapshots** (the prior
plugin's `JSON.parse(JSON.stringify(...))` per action). This bounds memory and
makes undo O(change), not O(document).

### 5.4 Persistence
- `TextFileView` drives load/save for `*.ink.md`. `getViewData()` re-emits the
  full markdown: **untouched body** + regenerated `%%inkedmark … %%` block.
- Save is **debounced + incremental**: re-encode/compress only on idle, not on
  every stroke. Compression may move to a Web Worker if it costs frame time
  (optimization, measured).
- The plugin must **preserve the user's markdown body verbatim** — it owns only
  its data block and (when writing the text layer) clearly delimited regions.

---

## 6. Search & graph integration

- **Search:** the text layer is real markdown body text → Obsidian's core search
  indexes it with zero extra work. Handwritten notes are found by their typed
  transcription/title/keywords.
- **Graph & backlinks:** `[[links]]` and `#tags` in the text layer (and
  frontmatter `tags`) are parsed by Obsidian normally → ink notes appear as
  nodes with real edges.
- **Embeds in the graph:** `![[Sketch.ink.md]]` creates a normal embed edge from
  host note to ink note.
- **Quick Switcher / Unlinked mentions / Properties:** all work because the file
  is `.md` with frontmatter. No custom search index is built or needed in v1.

This is the entire reason for the `.md`-based format: we inherit Obsidian's
indexing instead of reimplementing it.

---

## 7. Recognition (HWR) — pluggable, deferred engine

v1 ships **manual** text layering. The architecture reserves the automation slot
so a provider can populate the same text layer later with no format change.

```ts
// recognition/provider.ts
export interface RecognitionRequest {
  strokes: Stroke[];            // region strokes in world coords
  hint?: "prose" | "math" | "mixed";
  locale?: string;
}
export interface RecognitionResult {
  text: string;                 // markdown-ready
  confidence: number;           // 0..1
  // optional per-line/word boxes for future highlight-on-search
  segments?: { text: string; bounds: Bounds; confidence: number }[];
}
export interface RecognitionProvider {
  readonly id: string;
  readonly requiresNetwork: boolean;
  recognize(req: RecognitionRequest): Promise<RecognitionResult>;
}
```

- **v1 provider:** `ManualProvider` — no-op; the user types the text layer.
- **v2 candidates (behind settings, not in v1 scope):**
  - *On-device:* TrOCR (handwritten) via `transformers.js`/ONNX-WASM — private,
    offline, heavy; prototype behind a flag.
  - *Cloud:* MyScript iink or Google Cloud Vision — high accuracy, requires
    network + keys; opt-in only, never default (local-first is a goal).
- Recognition runs **in the background**, is incremental per region, and writes
  into the text layer via `recognition/text-layer.ts`. The user can always edit
  the result.

---

## 8. Settings

```ts
export interface InkedMarkSettings {
  pressureEnabled: boolean;        // default true
  defaultTool: "pen" | "eraser" | "select" | "pan";
  customColors: string[];          // hex
  defaultColor: string;
  defaultSize: number;             // index/value into SIZES
  highlighterAlpha: number;        // 0..1, default ~0.4
  paperWidth: number;              // logical px width of the roll, default 1024
  recognitionProviderId: string;   // "manual" in v1
  twoFileStorage: boolean;         // future; default false (single-file)
  desynchronizedCanvas: boolean;   // default true; escape hatch if platform buggy
}
```
Settings persist via `loadData`/`saveData` (plugin `data.json`), independent of
any note. A single source of truth for `version` lives in `manifest.json` (see
§11 tooling) — no `package.json` drift.

---

## 9. Commands & UI

- **Commands** (palette): `Create handwriting note`, `Insert inline handwriting`,
  `Toggle canvas / markdown view`, `Recognize handwriting in this note` (no-op in
  v1), `Fit / Reset view`.
- **Ribbon:** create handwriting note.
- **Toolbar** (`view/toolbar.ts`): pen, highlighter, eraser, select, pan;
  color palette + custom-color add/remove; sizes; pressure toggle; undo/redo;
  zoom in/out/fit/reset; delete selection; clear. Mobile-safe icons (bundled
  Lucide via `addIcon`, explicit SVG width/height attributes, text-label
  fallback) — carry forward the prior plugin's hard-won WebKit fixes.
- **Keyboard:** `P` pen, `H`(ighlighter)/`E` eraser, `V` select, space/`G` pan,
  `⌘/Ctrl+Z`/`⇧Z` undo/redo, `Delete` removes selection. Guard against firing
  while a text input/contenteditable is focused and only when the InkedMark leaf
  is active.

---

## 10. Performance targets & strategies

| Concern | Target | Strategy |
|---|---|---|
| Draw latency (iPad) | imperceptible wet ink | wet/dry canvas split, synchronous wet draw, `desynchronized` ctx, predicted points |
| Capture fidelity | full Pencil rate | `getCoalescedEvents()` |
| Frame rate | 60fps with ~5k strokes/page | viewport culling + spatial index + cached static dry layer |
| Hit-test / erase | O(log n)/O(1)-ish per query | uniform-grid spatial index, not linear scan |
| Undo memory | O(change) | command pattern, no snapshots |
| Save cost | off the draw path | debounced + incremental encode; optional worker compression |
| File size | ~10×+ smaller than prior | tuple-packed quantized points + deflate |

**Go/No-Go checkpoint (honest):** after Phase 0.1, measure real wet-ink latency
on a physical iPad in the Obsidian webview. The whole premise rests on this
being good enough. If it is not acceptable even with the wet/dry split +
coalesced/predicted events + desynchronized context, stop and reassess before
investing in 0.2+. Record the measurement in the repo.

---

## 11. Tooling, build & CI

### Language / build
- **TypeScript**, full `strict: true` (not just `strictNullChecks`).
- **esbuild** bundler (`esbuild.config.mjs`): dev watch (inline sourcemap) +
  production (minified, no sourcemap). Entry `src/main.ts` → `main.js` (CJS).
  Externalize `obsidian`, `electron`, CodeMirror `@codemirror/*`, `@lezer/*`,
  and Node builtins. Bundle `perfect-freehand` and `fflate`.
- **Version single-sourced** from `manifest.json`; `version-bump.mjs` updates
  `manifest.json` + `versions.json` together (standard Obsidian pattern). Do not
  rely on `package.json` version.

### Quality gates (npm scripts)
```jsonc
{
  "dev":        "node esbuild.config.mjs",
  "build":      "tsc --noEmit && node esbuild.config.mjs production",
  "lint":       "eslint . --max-warnings 0",
  "format":     "prettier --write .",
  "format:check":"prettier --check .",
  "test":       "vitest run",
  "test:watch": "vitest",
  "typecheck":  "tsc --noEmit",
  "version":    "node version-bump.mjs && git add manifest.json versions.json"
}
```
- **ESLint** (`@typescript-eslint`) + **Prettier**, both wired (the prior repo
  had eslint deps but no script — fixed here). `eslint . --max-warnings 0` is a
  hard gate.
- **Vitest** for unit tests (TS-native, fast). `@vitest/coverage-v8`.
- Optional: **husky + lint-staged** pre-commit (format + lint changed files).

### Dependencies
- Runtime: `perfect-freehand`, `fflate`.
- Dev: `obsidian`, `esbuild`, `typescript`, `@typescript-eslint/*`, `eslint`,
  `prettier`, `vitest`, `@vitest/coverage-v8`, `@types/node`, `builtin-modules`,
  `tslib`.

### GitHub Actions (`.github/workflows/`)
1. **`ci.yml`** — on push + PR: `npm ci` → `lint` → `typecheck` → `test` →
   `build`. Node 20. This is the merge gate.
2. **`release.yml`** — on tag push `*.*.*`: build, then create a GitHub Release
   attaching `main.js`, `manifest.json`, `styles.css` (the three Obsidian
   release artifacts). Mirrors the official `obsidian-sample-plugin` release
   flow so the community-plugin updater and BRAT both work.
3. **`pages.yml`** — on push to `main` touching `docs/`: build/deploy the static
   website to GitHub Pages with `CNAME = inkedmark.com`.

Release artifacts (`main.js`, `*.js.map`) and `data.json` are gitignored.

---

## 12. Website (GitHub Pages, inkedmark.com)

Keep it **simple and static** — no heavy framework. A `docs/` folder served by
Pages:
```
docs/
  index.html        # landing: one-liner, hero GIF, 3 feature blurbs, install CTA
  styles.css
  CNAME             # inkedmark.com
  assets/           # screenshots, demo GIFs, icon
```
Content: what InkedMark is, the "handwriting that lives in your notes"
positioning, a demo GIF (pen + search), install via Community Plugins / BRAT,
link to GitHub. Plain HTML/CSS is sufficient; Astro is acceptable if richer docs
are wanted later, but not required for launch.

---

## 13. Testing strategy

Unit tests (Vitest) target the **pure** modules — that is the point of the
layered architecture:
- `model/serialize` + `model/compress`: encode→decode round-trip is lossless
  modulo quantization; version migration; malformed input degrades safely.
- `model/commands` + `history`: `apply()`/`invert()` restore prior state;
  undo/redo sequences; redo cleared on new action.
- `canvas/hit-test` + `spatial-index`: hit correctness vs brute force on random
  strokes; cull set correctness; rect/bounds intersection edge cases.
- `ink/stroke-builder`: decimation/min-distance thresholds; pressure mapping.
- `input/palm-rejection`: state-machine transitions (pen↔touch arbitration).
- `recognition/text-layer`: region-text ↔ markdown-body sync; user prose
  preserved.

DOM/view code (`renderer`, `ink-view`, `embed-processor`) stays thin; cover with
a few jsdom smoke tests and manual device QA. **Coverage target ≥80% on
`model/`, `canvas/` (pure), `ink/`, `input/palm-rejection`, `recognition/`.**

---

## 14. Repo structure (top level)

```
obsidian-inkedmark/
  src/                     # see §5
  docs/                    # website (§12)
  tests/                   # Vitest specs mirroring src/ (or *.test.ts beside src)
  .github/workflows/       # ci.yml, release.yml, pages.yml
  manifest.json            # id=inkedmark, version source of truth, isDesktopOnly:false
  versions.json            # version -> minAppVersion map
  esbuild.config.mjs
  version-bump.mjs
  tsconfig.json            # strict:true
  .eslintrc.cjs / eslint.config.mjs
  .prettierrc
  vitest.config.ts
  styles.css
  package.json
  README.md
  SPECIFICATION.md         # this file
  LICENSE                  # MIT (present)
```

---

## 15. Phased roadmap

- **0.1 — Foundation & ink MVP.** Repo scaffold + all tooling (TS strict, ESLint,
  Prettier, Vitest, esbuild, version-bump, `ci.yml`). Register `*.ink.md` view
  via `inkedmark: true` flag. Pen tool with `perfect-freehand`; pressure;
  coalesced events; wet/dry canvas + desynchronized ctx; vertical paper-roll;
  save/load with quantized+deflated block; minimal toolbar. **→ Run the §10
  Go/No-Go latency test on iPad.**
- **0.2 — Editing & robustness.** Highlighter; eraser; box-select + move;
  command-pattern undo/redo; spatial index; viewport culling + static-layer
  cache; palm-rejection state machine; incremental debounced save; pinch/pan
  gestures.
- **0.3 — Markdown integration & search.** Text-layer panel (typed
  transcription, links, tags) with verbatim body preservation; inline embeds
  `![[*.ink.md]]` and ```` ```inkedmark ```` reading-mode post-processor;
  captions; verify search/graph/backlinks/Quick-Switcher all work end-to-end.
- **0.4 — Recognition slot + live preview.** `RecognitionProvider` wired with
  `ManualProvider` default; CodeMirror editor extension so inline blocks render
  in live preview (not just reading mode); optional on-device HWR prototype
  behind a flag.
- **0.5 — Polish & release.** Settings tab; mobile/iPad QA pass; `release.yml`;
  website + `pages.yml`; README with GIFs; community-plugin submission; BRAT
  beta.

---

## 16. Starting a fresh Claude Code session — recommended

**Yes — start a new session for implementation, seeded with this file.** This
session's context is saturated with the *old* `obsidian-pencil` codebase, which
is irrelevant to (and could bias) a clean build. A fresh session whose first
input is "Read `SPECIFICATION.md` and scaffold Phase 0.1" will have clean, cheap
context and a single source of truth.

Suggested kickoff for the new session:
1. `cd` into `obsidian-inkedmark`; read `SPECIFICATION.md`.
2. Scaffold Phase 0.1: `package.json`, `tsconfig.json` (strict), ESLint +
   Prettier configs, `vitest.config.ts`, `esbuild.config.mjs`, `version-bump.mjs`,
   `manifest.json` (id `inkedmark`), `.github/workflows/ci.yml`, `.gitignore`.
3. Implement `model/` (types, serialize, compress) **with tests first** — these
   are pure and define the format.
4. Then `ink/` + minimal `canvas/renderer` + `input/pointer-controller` + a bare
   `view/ink-view` to draw and save one pen tool.
5. Build, write the iPad latency note, then proceed to 0.2.

---

## 17. Open decisions (revisit with data)

- **Single-file vs two-file storage.** Committed to single-file `.ink.md`.
  Revisit only if real-world search-index noise from the base64 block proves
  material; the fallback is `twoFileStorage` (text `.ink.md` + binary
  `.inkedmark`).
- **`desynchronized` canvas on iOS WebKit.** Historically flaky; gated behind a
  setting (default on) with graceful fallback. Confirm on device in 0.1.
- **HWR engine for v2.** TrOCR/transformers.js (private, heavy) vs MyScript/cloud
  (accurate, networked). Decide after v1 ships, informed by user demand.
- **Live-preview rendering of inline blocks** (Cm6 editor extension) is more work
  than the reading-mode post-processor — intentionally phased to 0.4.
- **Latency Go/No-Go.** If 0.1 latency on iPad is unacceptable, the web/Obsidian
  premise is in question; reassess rather than push forward.
```
