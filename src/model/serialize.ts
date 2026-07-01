/**
 * Encode/decode between an {@link InkDocument} and its on-disk representation,
 * and between a full `*.ink.md` file and (markdown body + document).
 *
 * On-disk payload: `v<version>:` + base64(deflate(JSON)). Points are
 * quantized to integers (x/y at 1/100 px, pressure at 1/255) inside the JSON.
 * The round-trip is lossless modulo that quantization.
 *
 * Pure: no DOM, no Obsidian.
 */

import { BLOCK_LABEL, SCHEMA_VERSION } from "../constants";
import { deflateToBase64, inflateFromBase64 } from "./compress";
import {
  type InkDocument,
  type Region,
  type Stroke,
  type Tool,
  type ViewState,
  POINT_STRIDE,
} from "./document";

const XY_SCALE = 100;
const PRESSURE_SCALE = 255;

/** Raised for any malformed payload so callers can degrade to an empty doc. */
export class SerializeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SerializeError";
  }
}

// --- Point quantization -----------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Quantize world-space float points to compact integers for storage. */
export function quantizePts(pts: number[]): number[] {
  const out = new Array<number>(pts.length);
  for (let i = 0; i < pts.length; i += POINT_STRIDE) {
    out[i] = Math.round(pts[i] * XY_SCALE);
    out[i + 1] = Math.round(pts[i + 1] * XY_SCALE);
    out[i + 2] = clamp(Math.round(pts[i + 2] * PRESSURE_SCALE), 0, PRESSURE_SCALE);
  }
  return out;
}

/** Reconstitute float world-space points from quantized integers. */
export function dequantizePts(pts: number[]): number[] {
  const out = new Array<number>(pts.length);
  for (let i = 0; i < pts.length; i += POINT_STRIDE) {
    out[i] = pts[i] / XY_SCALE;
    out[i + 1] = pts[i + 1] / XY_SCALE;
    out[i + 2] = pts[i + 2] / PRESSURE_SCALE;
  }
  return out;
}

// --- Document <-> payload ----------------------------------------------------

interface StoredStroke {
  id: string;
  color: string;
  size: number;
  tool: string;
  pts: number[];
}

interface StoredRegion {
  id: string;
  kind: string;
  strokes: StoredStroke[];
}

interface StoredDocument {
  version: number;
  view: ViewState;
  regions: StoredRegion[];
}

function toStored(doc: InkDocument): StoredDocument {
  return {
    version: SCHEMA_VERSION,
    view: doc.view,
    regions: doc.regions.map((region) => ({
      id: region.id,
      kind: region.kind,
      strokes: region.strokes.map((stroke) => ({
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        tool: stroke.tool,
        pts: quantizePts(stroke.pts),
      })),
    })),
  };
}

/** Serialize a document to its `v<n>:<base64>` payload string. */
export function encodeDocument(doc: InkDocument): string {
  const json = JSON.stringify(toStored(doc));
  return `v${SCHEMA_VERSION}:${deflateToBase64(json)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asTool(value: unknown): Tool {
  return value === "highlighter" ? "highlighter" : "pen";
}

function normalizeView(raw: unknown, fallbackWidth: number): ViewState {
  const view = isRecord(raw) ? raw : {};
  const num = (v: unknown, d: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  return {
    scrollY: num(view.scrollY, 0),
    width: num(view.width, fallbackWidth),
    scale: num(view.scale, 1),
  };
}

function normalizeStroke(raw: unknown, index: number): Stroke | null {
  if (!isRecord(raw)) return null;
  const pts = Array.isArray(raw.pts)
    ? raw.pts.filter((n): n is number => typeof n === "number")
    : [];
  // Drop a trailing partial point so length stays a multiple of the stride.
  const usable = pts.length - (pts.length % POINT_STRIDE);
  return {
    id: typeof raw.id === "string" ? raw.id : `s${index + 1}`,
    color: typeof raw.color === "string" ? raw.color : "#1a1a1a",
    size: typeof raw.size === "number" && raw.size > 0 ? raw.size : 3,
    tool: asTool(raw.tool),
    pts: dequantizePts(pts.slice(0, usable)),
  };
}

function normalizeRegion(raw: unknown, index: number): Region {
  const region = isRecord(raw) ? raw : {};
  const strokesRaw = Array.isArray(region.strokes) ? region.strokes : [];
  const strokes: Stroke[] = [];
  strokesRaw.forEach((s, i) => {
    const stroke = normalizeStroke(s, i);
    if (stroke) strokes.push(stroke);
  });
  return {
    id: typeof region.id === "string" ? region.id : `r${index + 1}`,
    kind: "ink",
    strokes,
  };
}

/**
 * Apply forward migrations and normalize an untrusted parsed object into a valid
 * {@link InkDocument}. Unknown versions are best-effort decoded as the latest.
 */
function migrate(raw: unknown, _version: number, fallbackWidth: number): InkDocument {
  if (!isRecord(raw)) throw new SerializeError("payload is not an object");
  const regionsRaw = Array.isArray(raw.regions) ? raw.regions : [];
  const regions = regionsRaw.map((r, i) => normalizeRegion(r, i));
  if (regions.length === 0) regions.push({ id: "r1", kind: "ink", strokes: [] });
  return {
    version: SCHEMA_VERSION,
    view: normalizeView(raw.view, fallbackWidth),
    regions,
  };
}

/** Parse a `v<n>:<base64>` payload back into a document. */
export function decodeDocument(payload: string, fallbackWidth = 1024): InkDocument {
  const trimmed = payload.trim();
  const sep = trimmed.indexOf(":");
  if (trimmed[0] !== "v" || sep < 0) {
    throw new SerializeError("missing `v<n>:` version prefix");
  }
  const version = Number(trimmed.slice(1, sep));
  if (!Number.isFinite(version)) throw new SerializeError("invalid version number");

  let json: string;
  try {
    json = inflateFromBase64(trimmed.slice(sep + 1));
  } catch (cause) {
    throw new SerializeError("failed to inflate payload", cause);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new SerializeError("failed to parse payload JSON", cause);
  }

  return migrate(parsed, version, fallbackWidth);
}

// --- Full `.ink.md` file <-> (body, document) -------------------------------

const FRONTMATTER_RE = /^(\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/;

/** Split leading YAML frontmatter from the rest of the body (prose). */
export function splitFrontmatter(body: string): { frontmatter: string; prose: string } {
  const match = FRONTMATTER_RE.exec(body);
  if (match) return { frontmatter: match[1], prose: match[2] };
  return { frontmatter: "", prose: body };
}

export interface ParsedInkFile {
  /** Markdown body with the data block removed (the text layer + user prose). */
  body: string;
  /** Decoded document, or `null` if no valid block was present. */
  doc: InkDocument | null;
}

const OPEN = `%%${BLOCK_LABEL}`;

// Matches the `%%inkedmark … %%` block, with optional surrounding blank lines.
const BLOCK_RE = new RegExp(`\\n*[ \\t]*${OPEN}[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*%%[ \\t]*\\n?`);

/** Split a full `.ink.md` file into its markdown body and decoded document. */
export function parseInkFile(markdown: string, fallbackWidth = 1024): ParsedInkFile {
  const match = BLOCK_RE.exec(markdown);
  if (!match) return { body: markdown, doc: null };

  const body = markdown.slice(0, match.index) + markdown.slice(match.index + match[0].length);
  let doc: InkDocument | null = null;
  try {
    doc = decodeDocument(match[1], fallbackWidth);
  } catch {
    doc = null; // Degrade safely: keep the body, drop the unreadable block.
  }
  return { body, doc };
}

/** Re-emit a full `.ink.md` file: untouched body + regenerated data block. */
export function buildInkFile(body: string, doc: InkDocument): string {
  const payload = encodeDocument(doc);
  const trimmedBody = body.replace(/\s+$/, "");
  const separator = trimmedBody.length > 0 ? "\n\n" : "";
  return `${trimmedBody}${separator}%%${BLOCK_LABEL}\n${payload}\n%%\n`;
}
