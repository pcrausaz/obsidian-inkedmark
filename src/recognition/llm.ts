/**
 * BYOK cloud recognition provider: renders the note's ink to a PNG and asks a
 * vision LLM (Anthropic / OpenAI / Google, user-selected, user's own API key)
 * for a markdown transcription.
 *
 * Network transport is Obsidian's `requestUrl` (not the vendor SDKs): the
 * plugin runs inside Obsidian's webview where cross-origin fetch is blocked
 * for these APIs, and one uniform transport covers all three vendors without
 * bundling SDKs. Request/response shapes live in `llm-request.ts` (pure,
 * tested); image rendering lives in `render.ts`.
 */

import { requestUrl } from "obsidian";
import type { RecognitionProvider, RecognitionRequest, RecognitionResult } from "./provider";
import {
  LLM_PROVIDER_ID,
  type LlmVendor,
  VENDOR_LABELS,
  buildLlmRequest,
  buildRecognitionPrompt,
  cleanTranscription,
  defaultModelFor,
  extractLlmText,
} from "./llm-request";
import { renderStrokesForRecognition } from "./render";

export interface LlmProviderConfig {
  vendor: LlmVendor;
  /** Empty string means "use the vendor default". */
  model: string;
  apiKey: string;
}

export class LlmProvider implements RecognitionProvider {
  readonly id = LLM_PROVIDER_ID;
  readonly requiresNetwork = true;

  constructor(private readonly getConfig: () => LlmProviderConfig) {}

  async recognize(req: RecognitionRequest): Promise<RecognitionResult> {
    const cfg = this.getConfig();
    const vendorLabel = VENDOR_LABELS[cfg.vendor];
    if (!cfg.apiKey.trim()) {
      throw new Error(`no API key set for ${vendorLabel} — add one in InkedMark settings.`);
    }

    const image = renderStrokesForRecognition(req.strokes);
    if (!image) return { text: "", confidence: 0 };

    const request = buildLlmRequest({
      vendor: cfg.vendor,
      model: cfg.model.trim() || defaultModelFor(cfg.vendor),
      apiKey: cfg.apiKey.trim(),
      imageBase64: image.base64,
      prompt: buildRecognitionPrompt(req.hint, req.locale),
    });

    const response = await requestUrl({
      url: request.url,
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`${vendorLabel} rejected the API key — check it in settings.`);
      }
      throw new Error(`${vendorLabel} request failed (HTTP ${response.status}).`);
    }

    let json: unknown;
    try {
      json = response.json;
    } catch {
      throw new Error(`${vendorLabel} returned an unreadable response.`);
    }

    const text = cleanTranscription(extractLlmText(cfg.vendor, json));
    if (!text) throw new Error(`${vendorLabel} returned no transcription.`);
    return { text, confidence: 0.9 };
  }
}
