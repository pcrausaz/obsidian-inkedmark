# InkedMark — notes for coding agents

Obsidian plugin: pressure-aware handwriting fused with markdown. User-facing
docs live in README.md; design decisions and roadmap in SPECIFICATION.md;
manual test matrix in QA.md; release process in RELEASE.md.

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
