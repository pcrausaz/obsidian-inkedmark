# Changelog

All notable changes to InkedMark are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[semver](https://semver.org/). The GitHub Release notes for each tag are
extracted from the matching section of this file by `release.yml`.

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
