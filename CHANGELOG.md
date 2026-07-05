# Changelog

All notable changes to InkedMark are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[semver](https://semver.org/). The GitHub Release notes for each tag are
extracted from the matching section of this file by `release.yml`.

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
