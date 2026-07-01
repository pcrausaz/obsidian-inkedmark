/**
 * Handwriting-recognition provider interface (§7).
 *
 * v1 ships only {@link ManualProvider}; this slot lets a real engine populate
 * the same text layer later with no data-format change.
 */

import type { Bounds, Stroke } from "../model/document";

export interface RecognitionRequest {
  /** Region strokes in world coordinates. */
  strokes: Stroke[];
  hint?: "prose" | "math" | "mixed";
  locale?: string;
}

export interface RecognitionSegment {
  text: string;
  bounds: Bounds;
  confidence: number;
}

export interface RecognitionResult {
  /** Markdown-ready text. */
  text: string;
  /** Overall confidence in `0..1`. */
  confidence: number;
  /** Optional per-line/word boxes for future highlight-on-search. */
  segments?: RecognitionSegment[];
}

export interface RecognitionProvider {
  readonly id: string;
  readonly requiresNetwork: boolean;
  recognize(req: RecognitionRequest): Promise<RecognitionResult>;
}
