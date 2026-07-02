/**
 * Experimental on-device recognition via TrOCR (transformers.js / ONNX).
 *
 * The ink never leaves the device: strokes are segmented into lines
 * (`lines.ts`, pure), each line is rendered to a small image (`render.ts`),
 * and a local TrOCR model transcribes it. First use downloads the model
 * (~40 MB) from the Hugging Face CDN and the ONNX WASM runtime from jsDelivr;
 * both are cached by the browser afterwards. English handwriting only;
 * desktop-recommended (WebGPU when available, WASM fallback).
 */

import { TROCR_MODEL_ID } from "../constants";
import type { RecognitionProvider, RecognitionRequest, RecognitionResult } from "./provider";
import { groupStrokesIntoLines } from "./lines";
import { renderStrokesForRecognition } from "./render";

export const TROCR_PROVIDER_ID = "trocr-local";

/** Line images larger than this waste time: TrOCR downscales to 384px anyway. */
const LINE_MAX_EDGE = 768;

type ImageToTextOutput = Array<{ generated_text?: string }>;
type ImageToTextPipeline = (input: string) => Promise<ImageToTextOutput>;

export class TrocrProvider implements RecognitionProvider {
  readonly id = TROCR_PROVIDER_ID;
  /** Ink is never transmitted; the one-time model download is disclosed in settings/README. */
  readonly requiresNetwork = false;

  private pipelinePromise: Promise<ImageToTextPipeline> | null = null;
  private onProgress: ((message: string) => void) | undefined;

  private loadPipeline(): Promise<ImageToTextPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = this.createPipeline().catch((error: unknown) => {
        this.pipelinePromise = null; // allow a retry after a failed download
        throw error;
      });
    }
    return this.pipelinePromise;
  }

  private async createPipeline(): Promise<ImageToTextPipeline> {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;

    const progressCallback = (info: { status?: string; progress?: number; file?: string }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        this.onProgress?.(`downloading model… ${Math.round(info.progress)}%`);
      }
    };

    // WebGPU is fast where present (desktop Electron); WASM is the safe fallback.
    try {
      return (await pipeline("image-to-text", TROCR_MODEL_ID, {
        device: "webgpu",
        progress_callback: progressCallback,
      })) as unknown as ImageToTextPipeline;
    } catch {
      return (await pipeline("image-to-text", TROCR_MODEL_ID, {
        device: "wasm",
        dtype: "q8",
        progress_callback: progressCallback,
      })) as unknown as ImageToTextPipeline;
    }
  }

  async recognize(req: RecognitionRequest): Promise<RecognitionResult> {
    this.onProgress = req.onProgress;
    const lines = groupStrokesIntoLines(req.strokes);
    if (lines.length === 0) return { text: "", confidence: 0 };

    req.onProgress?.("loading on-device model (first run downloads ~40 MB)…");
    const pipe = await this.loadPipeline();

    const texts: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      req.onProgress?.(`transcribing line ${i + 1}/${lines.length}…`);
      const image = renderStrokesForRecognition(lines[i], { maxEdge: LINE_MAX_EDGE, pad: 8 });
      if (!image) continue;
      const output = await pipe(`data:image/png;base64,${image.base64}`);
      const text = output?.[0]?.generated_text?.trim();
      if (text) texts.push(text);
    }

    if (texts.length === 0) {
      throw new Error("the on-device model produced no text for this ink.");
    }
    // Line-level OCR without a language model behind it: usable, not polished.
    return { text: texts.join("\n"), confidence: 0.5 };
  }
}
