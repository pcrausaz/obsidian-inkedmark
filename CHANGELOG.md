# Changelog

All notable changes to InkedMark are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[semver](https://semver.org/). The GitHub Release notes for each tag are
extracted from the matching section of this file by `release.yml`.

## [1.2.7] - 2026-08-12

Maintenance release clearing two build-time dependency advisories. Nothing
here reaches a vault — no plugin behavior changes.

### Security

- `js-yaml` bumped to 4.3.1 (quadratic CPU consumption in `!!omap`
  resolution, GHSA-5p4m-2wfm-xmqj; dev-only, via the eslint toolchain).
- `nanoid` bumped to 3.3.18 past GHSA-2v37-7h3g-55p8 (custom generators can
  loop indefinitely on zero size; dev-only, via vitest/vite/postcss; not yet
  flagged by Dependabot, caught by `npm audit`).

## [1.2.6] - 2026-08-04

Gemini recognition fixed for keys Google cut off from older models, real
error messages when a cloud vendor says no, and reproducible release builds.

### Fixed

- Cloud AI errors now include the vendor's own error message instead of just
  the HTTP status — a Gemini 404, for example, now says which model is
  unavailable rather than leaving you guessing at keys and settings.
  ([#16](https://github.com/pcrausaz/obsidian-inkedmark/issues/16))

### Changed

- The Gemini default model is now `gemini-3.5-flash` (was `gemini-2.5-flash`,
  which Google shuts down on 2026-10-16 and has already restricted for some
  keys). The OpenRouter default follows suit. Only affects an empty model
  field — an explicitly set model is never changed.

- Release builds are now reproducible: rebuilding `main.js` from the tagged
  source produces a byte-identical artifact. Previously a wall-clock build
  stamp was baked into every bundle, which made the directory review's
  rebuild-and-compare check flag every release. Dev builds keep the
  timestamped toolbar stamp.

## [1.2.5] - 2026-08-03

Maintenance release clearing two build-time dependency advisories that were
open when 1.2.4 was tagged. Nothing here reaches a vault — no plugin behavior
changes.

### Security

- `fast-uri` bumped to 3.1.5 (host confusion via backslash authority
  introducer; dev-only, via the ajv/eslint toolchain).
- `brace-expansion` ranges bumped past the CVE-2026-14257 mitigation-bypass
  DoS advisory (dev-only, via eslint/glob/test tooling; not yet flagged by
  Dependabot, caught by `npm audit`).
- The release checklist now includes a dependency-advisory check _before_
  tagging, so future releases don't ship with a known-open alert.

## [1.2.4] - 2026-08-03

Obsidian 1.13.4 shipped searchable settings; InkedMark's settings tab
(declarative since 1.2.0) now gives that search the right vocabulary.

### Changed

- Settings surface better in Obsidian 1.13's settings search: search aliases
  for the terms people actually type (OCR, stylus, Apple Pencil, self-hosted,
  Anthropic/OpenAI/Gemini/OpenRouter, offline, …), and descriptions added to
  the two settings that had none (Default stroke size, Cloud AI vendor).

## [1.2.3] - 2026-07-24

Maintenance release: dependency advisories cleared and the Cloud AI vendor
wiring consolidated. No user-visible behavior changes.

### Changed

- Cloud AI vendors are now defined by a single `VENDORS` descriptor table
  instead of per-vendor conditionals spread across four files. No behavior
  change — adding a vendor is one entry rather than a dozen edits.
  ([#7](https://github.com/pcrausaz/obsidian-inkedmark/issues/7))

### Security

- Build-time dependency updates clearing five Dependabot alerts: `postcss`
  (path traversal, via vite/vitest), `brace-expansion` (ReDoS, two ranges via
  eslint and the coverage tooling), `protobufjs` (DoS, via onnxruntime-web),
  and `sharp` (inherited libvips CVEs, forced to ^0.35.0 by an `overrides`
  entry since transformers.js still requires ^0.34.5). None of these reach a
  vault: an esbuild metafile confirms `sharp`, `protobufjs`, and
  `onnxruntime-node` are absent from the shipped `main.js`, which uses the
  browser/WASM backend. No plugin behavior changes.

## [1.2.2] - 2026-07-24

Cloud AI recognition no longer fails silently when a model runs out of output
budget — which reasoning models, increasingly common on OpenAI-compatible
services, hit routinely.

### Fixed

- Cloud AI recognition now detects a response that was cut off by the output
  token limit and says so, instead of silently writing a half-finished
  transcription into the note (or reporting the generic "returned no
  transcription"). Reasoning models made this reachable: their thinking tokens
  count against the same budget. ([#10](https://github.com/pcrausaz/obsidian-inkedmark/issues/10))

### Changed

- The per-page output budget for Cloud AI recognition is now 8192 tokens, up
  from 2048. It is a ceiling rather than an allocation, so unused headroom
  costs nothing; the old value left little room for models that reason before
  answering.
- `SELF_HOSTING.md` documents using the Custom endpoint vendor with a hosted
  OpenAI-compatible service, with Hetzner Inference as a worked example —
  including the exact-case model name, whose absence returns a 403 that looks
  like an API-key failure.

## [1.2.1] - 2026-07-20

Maintenance release — passes the community-directory source review for 1.2.0's
settings changes. No feature changes.

### Changed

- Calls to Obsidian 1.13 settings APIs are now version-guarded with
  `requireApiVersion`, the pattern the plugin review recognizes for hybrid
  code (`minAppVersion` stays 1.7.2 — older Obsidian versions keep working).
- DOM creation switched to Obsidian's `createEl`/`createDiv`/`createSpan`
  helpers everywhere; internal re-renders no longer go through the
  deprecated `display()` entry point.
- CI now runs the official `eslint-plugin-obsidianmd` review ruleset
  (`npm run lint:review`), so directory-review findings surface before a
  release instead of after.

## [1.2.0] - 2026-07-19

In-app changelog, searchable settings, and a security/docs cleanup.

### Added

- **What's new modal**: after updating, the next launch shows the changelog
  for the versions you skipped — once per vault, never on a fresh install.
  A new **View changelog** command reopens the full changelog anytime.

### Changed

- Settings tab now uses Obsidian 1.13's declarative settings API on current
  Obsidian versions, which makes InkedMark's settings searchable from the
  settings window's search field (closes #3). Older Obsidian versions keep
  the previous settings tab. The Paper width field now flags out-of-range
  values with a callout (like the Endpoint URL field) instead of silently
  ignoring them.

### Security

- Forced the transitive `adm-zip` dev/build dependency to 0.6.0
  (GHSA-xcpc-8h2w-3j85). Build-time only — `adm-zip` was never part of the
  plugin shipped to vaults.

## [1.1.0] - 2026-07-05

Self-hosted recognition and one-click OpenRouter setup.

### Added

- **Custom endpoint (OpenAI-compatible)** recognition vendor: point Cloud AI
  at a self-hosted server (Ollama, LM Studio, llama.cpp, vLLM, LocalAI) via a
  base-URL setting, so ink never leaves your own network. API key optional.
  The new [SELF_HOSTING.md](SELF_HOSTING.md) guide covers setup, reaching a
  home server from an iPad (Tailscale / Cloudflare Tunnel), and honest
  quality expectations for local models.
- **Connect OpenRouter**: one-click OAuth (PKCE) setup of a user-scoped API
  key from the settings tab — no manual key copy/paste.
- The Endpoint URL settings field validates as you type and shows what a
  complete URL looks like; it now also uses a full-width layout so long URLs
  stay readable on mobile.

### Changed

- Recognition errors name the configured endpoint and distinguish server
  access-control rejections (e.g. Ollama's localhost-only default behind a
  tunnel) from API-key problems, with pointers to the self-hosting guide.
- README network-use disclosure updated for the custom endpoint and the
  OpenRouter connect flow.
- Deferred (tracked in #7 — see SPECIFICATION.md §17): consolidating
  per-vendor recognition wiring into a descriptor table before the next
  vendor is added.

## [1.0.2] - 2026-07-03

Fixes for the community-directory source-code review.

- Inline style assignments replaced with CSS classes / `setCssStyles`
  (wet-layer visibility, embed canvas sizing, paper margin).
- Popout-window compatibility: `activeDocument` instead of `document`,
  `window.requestAnimationFrame`, and `window` instead of `globalThis` for the
  on-device backend's environment mask.
- `revealLeaf` awaited; `minAppVersion` raised to 1.7.2 to match its Promise
  signature.
- Typed `loadData` result; removed an unnecessary type assertion and a
  deprecated `setDynamicTooltip` call; described all lint-directive comments.
- Build tooling: `builtin-modules` package replaced with Node's own
  `module.builtinModules`.
- Deferred (tracked in #3): migrating the settings tab off the deprecated
  `display()` to `getSettingDefinitions`.

## [1.0.1] - 2026-07-03

Community-directory submission feedback.

- Release assets (`main.js`, `manifest.json`, `styles.css`) now ship with
  GitHub artifact attestations — cryptographic proof they were built from
  this repository by CI. Verify with:
  `gh attestation verify main.js --repo pcrausaz/obsidian-inkedmark`.
- No functional changes.

## [1.0.0] - 2026-07-02

First public release.

### Ink

- Pen-first canvas view for `*.ink.md` notes: pressure-variable ink
  (perfect-freehand), highlighter, eraser, box-select/move/delete, undo/redo,
  pinch-zoom and finger pan, custom palettes and stroke sizes.
- Built for Apple Pencil: full-rate capture via coalesced events, palm
  rejection, low-latency wet/dry canvas split. Verified on iPad Pro 12.9″
  (4th gen).
- Theme-adaptive ink: notes written in dark mode stay legible on light-mode
  devices and vice versa (deliberate colors are never remapped).
- Plain-markdown storage: frontmatter + typed text layer + compressed stroke
  block in a single `.md` file — syncs, diffs, and links like any note.

### Search & embeds

- Typed text layer (transcription, `[[links]]`, `#tags`) indexed by Obsidian's
  core search, graph, backlinks, and Quick Switcher.
- `![[Sketch.ink.md]]` file embeds and ` ```inkedmark ` fenced blocks render
  ink inline in reading mode and Live Preview.

### Handwriting recognition

- Cloud AI (bring your own key): Anthropic, OpenAI, Google, or OpenRouter
  vision models transcribe a page into the managed text section, after a
  one-time consent. Toolbar scan button, command, and opt-in background
  auto-recognition (skips unchanged ink).
- On-device recognition (experimental, desktop only): local TrOCR via
  transformers.js — ink never leaves the device.

### Safety

- Data-safety guard: a note whose ink data fails to load (partial sync,
  unreadable block) becomes read-protected — saves echo the original bytes, so
  ink can never be wiped by a bad read.
- Deflate-bomb guard on stroke decompression; injection-safe release workflow.
