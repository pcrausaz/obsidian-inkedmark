<p align="center">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="InkedMark logo" />
</p>

# InkedMark

> Handwriting that lives inside your notes — pressure-aware ink, fused with
> markdown, searchable and graphable like everything else in your vault.

InkedMark makes handwriting a **first-class block inside ordinary markdown
notes**. You write by hand where handwriting is better (diagrams, math,
marginalia, fast capture) and type where typing is better — in the _same note_ —
and Obsidian's search and graph see all of it through a first-class text layer.

- **Handwriting notes** — `*.ink.md` files open in a pen-first canvas view, yet
  stay plain markdown files that sync, diff, and link like any other note.
- **Searchable ink** — every handwriting note carries a typed _text layer_
  (transcription, key points, `[[links]]`, `#tags`) that Obsidian's core
  search, graph, backlinks, and Quick Switcher index with no extra work.
- **Inline sketches** — embed a handwriting note with `![[Sketch.ink.md]]`, or
  drop a small ` ```inkedmark ` block right inside any note.
- **Built for Apple Pencil** — pressure-variable ink (perfect-freehand),
  full-rate capture via coalesced events, palm rejection, and a low-latency
  wet/dry canvas split. Works on desktop, iPad, and mobile.

## Getting started

1. Install and enable InkedMark (see [Install](#install)).
2. Click the **pen ribbon icon** or run **“Create handwriting note”** — a new
   `*.ink.md` note opens in the canvas view.
3. Write with your pen (or mouse). One finger scrolls; two fingers pinch-zoom.

### Toolbar & tools

| Tool        | Key | Notes                                                          |
| ----------- | --- | -------------------------------------------------------------- |
| Pen         | `P` | Pressure-sensitive ink                                         |
| Highlighter | `H` | Translucent, multiply-blended                                  |
| Eraser      | `E` | Drag across strokes; one undo step per gesture                 |
| Select      | `V` | Drag a box to select; drag inside it to move; `Delete` removes |

Plus: color swatches (add your own in settings), stroke sizes, a pressure
toggle, undo/redo (`Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`), clear, and zoom
out / fit / in. The right side of the toolbar shows version, build, stroke
count, and zoom.

### Commands

- **Create handwriting note** — new `*.ink.md` in the current folder.
- **Insert inline handwriting** — inserts a starter ` ```inkedmark ` block.
- **Toggle canvas / markdown view** — see the raw markdown of an ink note.
- **Toggle text layer panel** — open the transcription panel.
- **Recognize handwriting in this note** — runs the recognition provider
  (v1 ships manual transcription; automatic HWR is a future provider).
- **Zoom in / Zoom out / Fit / reset view**, **Toggle input debug overlay**.

### The text layer (search & graph)

Open the text-layer panel (toolbar `📄` button or command) and type a
transcription, key points, `[[links]]`, and `#tags`. That text is stored as the
note's markdown body, so **handwritten notes show up in search, the graph,
backlinks, and the Quick Switcher** — find a sketch by its transcription, and
its links become real graph edges.

### Inline handwriting in regular notes

- `![[Sketch.ink.md]]` renders the sketch inside any note (reading mode and
  live preview).
- ` ```inkedmark ` blocks hold a small drawing in place, with an optional
  `caption:` line that doubles as its searchable text. Editing ink inline
  happens in the dedicated note; inline blocks render read-only.

### File format

An ink note is a single markdown file: frontmatter (`inkedmark: true`), your
text layer as the body, and the stroke data in a trailing
`%%inkedmark … %%` comment (quantized, compressed, invisible in reading view).
No sidecar files; atomic sync and version control.

## Install

- **Community plugins:** search for “InkedMark” (once accepted).
- **BRAT (beta):** add `pcrausaz/obsidian-inkedmark`.
- **Manual:** copy `main.js`, `manifest.json`, and `styles.css` from a
  [release](https://github.com/pcrausaz/obsidian-inkedmark/releases) into
  `<vault>/.obsidian/plugins/inkedmark/`, then enable it.

## iPad / Apple Pencil setup — important

**Turn off iPadOS Scribble:** _Settings → Apple Pencil → Scribble (off)._

iPadOS “Scribble” (the system handwriting-to-text feature) intercepts fast
Apple Pencil strokes at the OS level, _before_ they reach Obsidian's web view —
so with it on, quick handwriting drops strokes. This is an iPadOS/WebKit
behavior no plugin can disable or detect. With Scribble off, capture is smooth
(verified on an iPad Pro 12.9″ 4th-gen, Apple Pencil 2). InkedMark shows a
one-time reminder and a settings note on iPad.

## Troubleshooting

- **Strokes go missing on iPad** → turn off Scribble (above).
- **Diagnosing input problems** → enable **Input debug overlay** (settings →
  Support and diagnostics, or the command). It shows the raw event stream,
  timing gaps, and stroke counts — include a screenshot of it when reporting
  input bugs.
- **Ink looks corrupted** → try turning off **Desynchronized canvas** in
  settings (some WebKit versions are flaky with it).
- **Not sure which build you're running** → the toolbar's right side shows the
  exact version and build stamp.

## Support

- **Email:** [support@inkedmark.com](mailto:support@inkedmark.com)
- **Bugs & feature requests:**
  [GitHub issues](https://github.com/pcrausaz/obsidian-inkedmark/issues)
- **Website:** [inkedmark.com](https://inkedmark.com)

## Development

```bash
npm install
npm run dev          # esbuild watch (inline sourcemap)
npm run test         # vitest (pure modules)
npm run lint         # eslint, zero-warning gate
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production bundle
```

The build emits `main.js`; together with `manifest.json` and `styles.css` it
forms the Obsidian plugin. See [`SPECIFICATION.md`](./SPECIFICATION.md) for the
technical brief, [`QA.md`](./QA.md) for the on-device test pass,
[`KNOWN-ISSUES.md`](./KNOWN-ISSUES.md) for tracked bugs, and
[`RELEASE.md`](./RELEASE.md) for the release flow.

### Deploying to a test vault (incl. iPad via iCloud)

Point the build at a vault's plugin folder by creating a gitignored
`.deploy-target` file at the repo root containing that path, e.g.

```
/Users/you/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault/.obsidian/plugins/inkedmark
```

(or set `OBSIDIAN_PLUGIN_DIR` in the environment). Then:

- `npm run dev` — watch build; **auto-copies** the three artifacts into the
  target on every rebuild.
- `npm run deploy` — copy the current artifacts without rebuilding.

A `.hotreload` marker is written alongside so the desktop
[Hot-Reload](https://github.com/pjeby/hot-reload) plugin reloads on change.

> **iPad note:** point `.deploy-target` at an **iCloud-stored** vault — iCloud
> syncs the copied files to the iPad (symlinks do **not** sync, which is why the
> build copies real files). After a deploy, wait for iCloud to sync, then reload
> the plugin on the iPad.

## License

MIT © 2026 [liqpil.com](https://liqpil.com)
