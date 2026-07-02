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

import { TROCR_MODELS, type TrocrSize } from "../constants";
import type { RecognitionProvider, RecognitionRequest, RecognitionResult } from "./provider";
import { groupStrokesIntoLines } from "./lines";
import { renderStrokesForRecognition } from "./render";

export const TROCR_PROVIDER_ID = "trocr-local";

/** Line images larger than this waste time: TrOCR downscales to 384px anyway. */
const LINE_MAX_EDGE = 768;

type ImageToTextOutput = Array<{ generated_text?: string }>;
type ImageToTextPipeline = (input: string) => Promise<ImageToTextOutput>;

/** The slice of transformers.js this provider uses. */
interface TransformersModule {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>;
  env: { allowLocalModels: boolean };
}

export interface TrocrConfig {
  size: TrocrSize;
}

export class TrocrProvider implements RecognitionProvider {
  readonly id = TROCR_PROVIDER_ID;
  /** Ink is never transmitted; the one-time model download is disclosed in settings/README. */
  readonly requiresNetwork = false;

  /** One pipeline per model id, so switching model size doesn't re-download the other. */
  private readonly pipelines = new Map<string, Promise<ImageToTextPipeline>>();
  private onProgress: ((message: string) => void) | undefined;

  constructor(private readonly getConfig: () => TrocrConfig) {}

  private loadPipeline(modelId: string): Promise<ImageToTextPipeline> {
    let promise = this.pipelines.get(modelId);
    if (!promise) {
      promise = this.createPipeline(modelId).catch((error: unknown) => {
        this.pipelines.delete(modelId); // allow a retry after a failed download
        throw error;
      });
      this.pipelines.set(modelId, promise);
    }
    return promise;
  }

  /**
   * Import transformers.js with the BROWSER backend forced. Obsidian desktop is
   * Electron, where `process.release.name === "node"`, so the library's env
   * detection picks its Node backend (onnxruntime-node: devices coreml/webgpu/
   * cpu) — whose native binaries a plugin cannot ship ("Unsupported device:
   * wasm" on macOS). Masking `process` for the module-init tick makes it select
   * the web/WASM backend instead; the mask is restored immediately after.
   */
  private async importTransformers(): Promise<TransformersModule> {
    const g = globalThis as { process?: unknown };
    const original = g.process;
    const mask = typeof window !== "undefined" && original !== undefined;
    if (mask) g.process = undefined;
    try {
      return (await import("@huggingface/transformers")) as unknown as TransformersModule;
    } finally {
      if (mask) g.process = original;
    }
  }

  private async createPipeline(modelId: string): Promise<ImageToTextPipeline> {
    const { pipeline, env } = await this.importTransformers();
    env.allowLocalModels = false;

    const progressCallback = (info: { status?: string; progress?: number; file?: string }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        this.onProgress?.(`downloading model… ${Math.round(info.progress)}%`);
      }
    };

    // WebGPU is fast where present (desktop Electron); WASM is the safe
    // fallback. Explicit dtypes keep the download honest: fp16 on WebGPU
    // (half the fp32 default), q8 on WASM.
    try {
      return (await pipeline("image-to-text", modelId, {
        device: "webgpu",
        dtype: "fp16",
        progress_callback: progressCallback,
      })) as unknown as ImageToTextPipeline;
    } catch {
      return (await pipeline("image-to-text", modelId, {
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

    const model = TROCR_MODELS[this.getConfig().size] ?? TROCR_MODELS.small;
    req.onProgress?.("loading on-device model (first run downloads it)…");
    const pipe = await this.loadPipeline(model.id);

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
