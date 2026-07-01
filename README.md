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

**Phase 0.1 — Foundation & ink MVP** (in progress):

- Repo scaffold + tooling: strict TypeScript, ESLint, Prettier, Vitest, esbuild,
  version-bump, CI.
- `*.ink.md` files rendered by a custom view (recognized via an
  `inkedmark: true` frontmatter flag).
- Pen tool with [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand),
  pressure, coalesced pointer events, a wet/dry canvas split, and a vertical
  paper-roll surface.
- Single-file storage: a quantized + deflated stroke block embedded in the
  markdown via an Obsidian `%%inkedmark … %%` comment.

> **Go/No-Go:** Phase 0.1 ends with a wet-ink latency measurement on a physical
> iPad in the Obsidian webview (see §10 of the spec). The whole premise rests on
> this being good enough.

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
