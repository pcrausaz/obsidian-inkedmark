/** Stable identifiers, file conventions, and tuning constants. */

/** Plugin id — must match manifest.json. */
export const PLUGIN_ID = "inkedmark";

/**
 * Build stamp injected by esbuild's `define` (see esbuild.config.mjs). Falls
 * back to "dev" when unbundled (e.g. under Vitest). Surfaced in the toolbar so
 * a tester can confirm which build is running.
 */
declare const __INKEDMARK_BUILD__: string;
export const BUILD_ID: string =
  typeof __INKEDMARK_BUILD__ !== "undefined" ? __INKEDMARK_BUILD__ : "dev";

/** Custom view type registered for `*.ink.md` files. */
export const VIEW_TYPE_INK = "inkedmark-view";

/** Filename suffix that marks a dedicated ink note. */
export const INK_FILE_SUFFIX = ".ink.md";

/** Frontmatter key whose truthy value claims a file for InkedMark. */
export const FRONTMATTER_FLAG = "inkedmark";

/** Frontmatter key holding the schema version. */
export const FRONTMATTER_VERSION = "inkedmark-version";

/** Label used in the `%%inkedmark … %%` data block and ```inkedmark``` fence. */
export const BLOCK_LABEL = "inkedmark";

/** Current stroke-document schema version. */
export const SCHEMA_VERSION = 1;

/** Default logical width of the paper roll, in CSS px. */
export const DEFAULT_PAPER_WIDTH = 1024;

/** Initial logical height of the paper roll, in CSS px. It grows with content. */
export const DEFAULT_PAPER_HEIGHT = 1400;

/** Extra vertical headroom kept below the lowest stroke, in CSS px. */
export const PAPER_GROWTH_MARGIN = 600;

/** Pen/highlighter sizes (stroke base width). */
export const SIZES = [2, 3, 5, 8, 12] as const;

/** Default ink palette (hex). Tuned to read on both light and dark themes. */
export const PALETTE = [
  "#1a1a1a",
  "#ffffff",
  "#e03131",
  "#1971c2",
  "#2f9e44",
  "#f08c00",
  "#9c36b5",
] as const;

/** Pressure fallback used for mouse input or when pressure is disabled. */
export const FALLBACK_PRESSURE = 0.5;

/** Minimum world-space distance between retained input samples, in CSS px. */
export const MIN_SAMPLE_DISTANCE = 1.4;

/** Highlighter default opacity. */
export const DEFAULT_HIGHLIGHTER_ALPHA = 0.4;

/** Eraser hit radius in screen px (converted to world via the viewport scale). */
export const ERASER_RADIUS = 12;

/** Idle delay before auto-recognition fires after the last ink change. */
export const AUTO_RECOGNIZE_IDLE_MS = 30_000;
