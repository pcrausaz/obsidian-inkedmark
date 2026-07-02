/**
 * Experimental on-device recognition via TrOCR (transformers.js / ONNX).
 *
 * The ink never leaves the device: strokes are segmented into lines
 * (`lines.ts`, pure), each line is rendered to a small image (`render.ts`),
 * and a local TrOCR model transcribes it. First use downloads the model from
 * the Hugging Face CDN and the ONNX WASM runtime from jsDelivr; both are
 * cached by the browser afterwards. English handwriting only;
 * desktop-recommended (WebGPU where it works, WASM everywhere else).
 */

import { Platform } from "obsidian";
import { TROCR_MODELS, TROCR_PROVIDER_ID, type TrocrSize } from "../constants";
import type { RecognitionProvider, RecognitionRequest, RecognitionResult } from "./provider";
import { groupStrokesIntoLines } from "./lines";
import { renderStrokesForRecognition } from "./render";

/** Line images larger than this waste time: TrOCR downscales to 384px anyway. */
const LINE_MAX_EDGE = 768;

type ImageToTextOutput = Array<{ generated_text?: string }>;
type ImageToTextPipeline = (input: string) => Promise<ImageToTextOutput>;

interface LoadedPipeline {
  pipe: ImageToTextPipeline;
  device: "webgpu" | "wasm";
}

/** The slice of transformers.js this provider uses. */
interface TransformersModule {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>;
  env: { allowLocalModels: boolean };
}

export interface TrocrConfig {
  size: TrocrSize;
}

/**
 * Whether WebGPU is worth attempting. iPadOS advertises `navigator.gpu` but
 * onnxruntime-web's WebGPU glue is broken inside the WKWebView ("webgpuInit is
 * not a function" — and only at first inference, past creation-time fallbacks),
 * so iOS always takes the WASM path.
 */
function webgpuWorthTrying(): boolean {
  if (Platform.isIosApp) return false;
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export { TROCR_PROVIDER_ID };

export class TrocrProvider implements RecognitionProvider {
  readonly id = TROCR_PROVIDER_ID;
  /** Ink is never transmitted; the one-time model download is disclosed in settings/README. */
  readonly requiresNetwork = false;

  /** One pipeline per model id, so switching model size doesn't re-download the other. */
  private readonly pipelines = new Map<string, Promise<LoadedPipeline>>();
  /** Models whose WebGPU path failed at runtime; they stay on WASM. */
  private readonly wasmOnly = new Set<string>();
  private onProgress: ((message: string) => void) | undefined;

  constructor(private readonly getConfig: () => TrocrConfig) {}

  private loadPipeline(modelId: string): Promise<LoadedPipeline> {
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

  private async createPipeline(modelId: string): Promise<LoadedPipeline> {
    const { pipeline, env } = await this.importTransformers();
    env.allowLocalModels = false;

    const progressCallback = (info: { status?: string; progress?: number; file?: string }) => {
      if (info.status === "progress" && typeof info.progress === "number") {
        this.onProgress?.(`downloading model… ${Math.round(info.progress)}%`);
      }
    };

    // fp32 everywhere, deliberately: the q8/fp16 exports of these models are
    // rejected by the on-device ONNX stack ("Missing required scale ..." in
    // the QDQ->MatMulNBits transform) even though the same files load fine in
    // isolation. fp32 has no quantization nodes and is the one configuration
    // proven on real devices. Bigger download, but it works.
    if (webgpuWorthTrying() && !this.wasmOnly.has(modelId)) {
      try {
        const pipe = (await pipeline("image-to-text", modelId, {
          device: "webgpu",
          progress_callback: progressCallback,
        })) as unknown as ImageToTextPipeline;
        return { pipe, device: "webgpu" };
      } catch {
        // fall through to WASM
      }
    }
    if (modelId === TROCR_MODELS.base.id) {
      throw new Error(
        "the Accurate (base) model needs WebGPU (desktop). Switch to the Fast model in settings.",
      );
    }
    const pipe = (await pipeline("image-to-text", modelId, {
      device: "wasm",
      dtype: "fp32",
      progress_callback: progressCallback,
    })) as unknown as ImageToTextPipeline;
    return { pipe, device: "wasm" };
  }

  /** Run the per-line OCR loop with the given pipeline. */
  private async transcribe(
    loaded: LoadedPipeline,
    lines: ReturnType<typeof groupStrokesIntoLines>,
    req: RecognitionRequest,
  ): Promise<string[]> {
    const texts: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      req.onProgress?.(`transcribing line ${i + 1}/${lines.length}…`);
      const image = renderStrokesForRecognition(lines[i], { maxEdge: LINE_MAX_EDGE, pad: 8 });
      if (!image) continue;
      const output = await loaded.pipe(`data:image/png;base64,${image.base64}`);
      const text = output?.[0]?.generated_text?.trim();
      if (text) texts.push(text);
    }
    return texts;
  }

  async recognize(req: RecognitionRequest): Promise<RecognitionResult> {
    this.onProgress = req.onProgress;
    const lines = groupStrokesIntoLines(req.strokes);
    if (lines.length === 0) return { text: "", confidence: 0 };

    const model = TROCR_MODELS[this.getConfig().size] ?? TROCR_MODELS.small;
    req.onProgress?.("loading on-device model (first run downloads it)…");
    let loaded = await this.loadPipeline(model.id);

    let texts: string[];
    try {
      texts = await this.transcribe(loaded, lines, req);
    } catch (error) {
      // onnxruntime's WebGPU backend can pass pipeline creation and only fail
      // at first inference (lazy device init). Retire WebGPU for this model
      // and retry once on WASM before giving up.
      if (loaded.device !== "webgpu") throw error;
      this.pipelines.delete(model.id);
      this.wasmOnly.add(model.id);
      req.onProgress?.("WebGPU failed — retrying on CPU (WASM)…");
      loaded = await this.loadPipeline(model.id);
      texts = await this.transcribe(loaded, lines, req);
    }

    if (texts.length === 0) {
      throw new Error("the on-device model produced no text for this ink.");
    }
    // Line-level OCR without a language model behind it: usable, not polished.
    return { text: texts.join("\n"), confidence: 0.5 };
  }
}
