# InkedMark — notes for coding agents

Obsidian plugin: pressure-aware handwriting fused with markdown.

## Document map — check the relevant one before/after a change

- `README.md` — user-facing docs, including the **Network use disclosure**,
  which must stay accurate whenever network behavior changes.
- `SPECIFICATION.md` — design decisions, rationale, roadmap, open decisions.
  Record strategy-level choices here, not in code comments.
- `SELF_HOSTING.md` — self-hosted recognition guide (custom endpoint vendor).
- `QA.md` — manual test matrix (desktop + iPad). Add cases for new
  user-facing features.
- `CHANGELOG.md` — update **before** releasing; the release flow in
  `RELEASE.md` expects the section to exist first.
- `RELEASE.md` — release process (`npm version` bumps manifest/versions.json
  and tags).
- `docs/` — the **public website** (GitHub Pages), not prose docs. Do not put
  markdown documentation there.

## Automation with public side effects (`.github/workflows/`)

- `pages.yml` — any push to `main` touching `docs/**` **deploys the public
  website**.
- `release.yml` — pushing a `*.*.*` tag **publishes a GitHub release** with
  attested artifacts.
- `ci.yml` — lint/typecheck/test/build on pushes to `main` and PRs.

In short: pushing to `main` or pushing tags can publish things. Don't do
either without being asked.

## Commands

- `npm test` — vitest (pure modules only; coverage thresholds enforced, see
  vitest.config.ts `include` list — add new pure modules there)
- `npm run typecheck` / `npm run lint` / `npm run format:check` — all must be
  clean; lint runs with `--max-warnings 0`
- `npm run build` — typecheck + production esbuild bundle
- `npm run dev` — watch-mode bundle

## Architecture conventions

- **Pure vs IO split**: testable logic lives in pure modules with no
  Obsidian/DOM/network imports (e.g. `src/recognition/llm-request.ts`,
  `src/recognition/openrouter-auth.ts`, `src/model/**`); the IO shell wraps
  them (`src/recognition/llm.ts`, `src/main.ts`). Follow this split for new
  features — pure part first, with tests.
- **Recognition providers** implement `RecognitionProvider`
  (`src/recognition/provider.ts`); the registry seeds Manual, and providers
  needing settings are registered in `main.ts` `onload()`.
- **Text layer**: transcriptions are written only inside the
  `<!--inkedmark-text-->` marker block (`src/recognition/text-layer.ts`);
  never touch user prose outside it.
- **Settings**: flat `InkedMarkSettings` in `src/settings.ts`; new fields need
  a `DEFAULT_SETTINGS` entry only (loadSettings merges defaults — no
  migration code).
- **Network**: all HTTP goes through Obsidian's `requestUrl` (CORS bypass on
  desktop and mobile). `requestUrl({throw:false})` still _rejects_ on
  connection-level failures — wrap in try/catch when the host may be down.
- **Mobile**: `isDesktopOnly: false` — everything must work on iPad unless
  explicitly gated via `Platform` checks (see the TrOCR provider for the
  pattern).
