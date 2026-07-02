/**
 * Lossless text <-> base64(deflate(text)) round-trip.
 *
 * Pure with respect to the document model. Uses `fflate` for deflate and the
 * platform `btoa`/`atob` (present in both the Obsidian/Electron webview and
 * Node 20) for base64 so the same code path runs in tests and at runtime.
 */

import { Inflate, deflateSync, strFromU8, strToU8 } from "fflate";

/** Largest slice handed to `String.fromCharCode` at once (avoids arg overflow). */
const CHUNK = 0x8000;

/**
 * Decompression ceiling (64 MB). Ink payloads are at most a few MB of JSON; the
 * cap stops a crafted "deflate bomb" in a shared/imported note from exhausting
 * memory when the block is decoded (embeds decode notes automatically).
 */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** UTF-8 text -> deflate -> base64. */
export function deflateToBase64(text: string): string {
  return bytesToBase64(deflateSync(strToU8(text)));
}

/**
 * Inverse of {@link deflateToBase64}. Throws if input is not valid deflate data
 * or would inflate past `maxBytes` (deflate-bomb guard).
 */
export function inflateFromBase64(base64: string, maxBytes = MAX_INFLATED_BYTES): string {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflate = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`inflated payload exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  });
  inflate.push(base64ToBytes(base64), true);

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return strFromU8(out);
}
