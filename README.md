# InkedMark

> Handwriting that lives inside your Obsidian notes — pressure-aware ink, fused
> with markdown, searchable and graphable like everything else in your vault.

InkedMark makes handwriting a **first-class block inside ordinary markdown
notes**. You write by hand where handwriting is better (diagrams, math,
marginalia, fast capture) and type where typing is better — in the _same note_ —
and Obsidian's search and graph see all of it through a first-class text layer.

This is a greenfield build. See [`SPECIFICATION.md`](./SPECIFICATION.md) for the
full technical brief, data formats, and roadmap.

## Status

**Phases 0.1 – 0.3 complete.** The §10 latency Go/No-Go passed on an iPad Pro
12.9″ 4th-gen (see the spec).

- **0.1 — Foundation & ink MVP.** Strict-TypeScript tooling (ESLint, Prettier,
  Vitest, esbuild, CI); `*.ink.md` files rendered by a custom view (recognized
  via an `inkedmark: true` frontmatter flag); pen with
  [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand),
  pressure, coalesced pointer events, a wet/dry canvas split, and a vertical
  paper-roll; single-file storage (quantized + deflated stroke block inside an
  Obsidian `%%inkedmark … %%` comment).
- **0.2 — Editing & robustness.** Highlighter, eraser, box-select/move/delete;
  delta-based undo/redo; uniform-grid spatial index + hit-test; viewport culling
  with O(1) incremental paint; palm-rejection; pinch-zoom + one/two-finger pan.
- **0.3 — Markdown integration & search.** A text-layer panel (searchable
  markdown body — transcription, `[[links]]`, `#tags`); reading-mode rendering of
  inline ` ```inkedmark ` blocks and `![[*.ink.md]]` embeds, with captions.

**Search & graph:** because the text layer and frontmatter `tags` are ordinary
markdown, Obsidian's core search, graph, backlinks, and Quick Switcher index
handwritten notes with no extra work — find a sketch by its transcription, and
`[[links]]`/`#tags` in the text layer become real graph edges.

## iPad / Apple Pencil setup — important

**Turn off iPadOS Scribble:** _Settings → Apple Pencil → Scribble (off)._

iPadOS "Scribble" (the system handwriting‑to‑text feature) intercepts fast
Apple Pencil strokes at the OS level, _before_ they reach Obsidian's web view —
so with it on, quick handwriting drops strokes. This is a WebKit/iPadOS
behavior, not an InkedMark bug: a plugin runs as JavaScript inside Obsidian's
web view and has no way to disable a native system feature. With Scribble off,
capture is smooth (verified on an iPad Pro 12.9″ 4th‑gen, Apple Pencil 2).
InkedMark shows a one‑time reminder and a settings‑tab note on iPad.

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
forms the Obsidian plugin.

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

MIT © 2026 Pascal Crausaz
