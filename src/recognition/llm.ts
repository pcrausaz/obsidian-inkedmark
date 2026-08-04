/**
 * BYOK cloud recognition provider: renders the note's ink to a PNG and asks a
 * vision LLM (Anthropic / OpenAI / Google / OpenRouter / a self-hosted
 * OpenAI-compatible endpoint, user-selected, user's own API key) for a
 * markdown transcription.
 *
 * Network transport is Obsidian's `requestUrl` (not the vendor SDKs): the
 * plugin runs inside Obsidian's webview where cross-origin fetch is blocked
 * for these APIs, and one uniform transport covers all three vendors without
 * bundling SDKs. Request/response shapes live in `llm-request.ts` (pure,
 * tested); image rendering lives in `render.ts`.
 */

import type { RecognitionProvider, RecognitionRequest, RecognitionResult } from "./provider";
import { postJson } from "./http";
import {
  LLM_PROVIDER_ID,
  MAX_OUTPUT_TOKENS,
  type LlmVendor,
  buildLlmRequest,
  buildRecognitionPrompt,
  cleanTranscription,
  defaultModelFor,
  describeLlmTarget,
  extractLlmErrorMessage,
  extractLlmText,
  isTruncatedLlmResponse,
  VENDORS,
} from "./llm-request";
import { renderStrokesForRecognition } from "./render";

export interface LlmProviderConfig {
  vendor: LlmVendor;
  /** Empty string means "use the vendor default". */
  model: string;
  /** Optional for the `custom` vendor. */
  apiKey: string;
  /** OpenAI-compatible base URL; only used when vendor is `custom`. */
  baseUrl: string;
}

export class LlmProvider implements RecognitionProvider {
  readonly id = LLM_PROVIDER_ID;
  readonly requiresNetwork = true;

  constructor(private readonly getConfig: () => LlmProviderConfig) {}

  async recognize(req: RecognitionRequest): Promise<RecognitionResult> {
    const cfg = this.getConfig();
    const vendor = VENDORS[cfg.vendor];
    const vendorLabel = describeLlmTarget(cfg.vendor, cfg.baseUrl);
    if (vendor.userEndpoint && !cfg.baseUrl.trim()) {
      throw new Error("no endpoint URL set — add one in InkedMark settings.");
    }
    if (vendor.requiresKey && !cfg.apiKey.trim()) {
      throw new Error(`no API key set for ${vendorLabel} — add one in InkedMark settings.`);
    }

    const image = renderStrokesForRecognition(req.strokes);
    if (!image) return { text: "", confidence: 0 };

    const request = buildLlmRequest({
      vendor: cfg.vendor,
      model: cfg.model.trim() || defaultModelFor(cfg.vendor),
      apiKey: cfg.apiKey.trim(),
      baseUrl: cfg.baseUrl,
      imageBase64: image.base64,
      prompt: buildRecognitionPrompt(req.hint, req.locale),
    });

    let response;
    try {
      response = await postJson(request.url, request.headers, request.body);
    } catch (err) {
      const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
      throw new Error(
        vendor.userEndpoint
          ? `could not reach ${vendorLabel} — is the server running and reachable ` +
              `from this device?${detail}`
          : `could not reach ${vendorLabel} — check your network connection.${detail}`,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      if (response.status === 401 || response.status === 403) {
        // For self-hosted endpoints a 401/403 is more often the server's own
        // access control than a bad key (e.g. Ollama only answers requests
        // addressed to localhost unless network access is enabled, so a
        // tunnel/proxy hostname gets an empty 403).
        throw new Error(
          vendor.userEndpoint
            ? `${vendorLabel} denied the request (HTTP ${response.status}). If the server needs an ` +
                "API key, set it in settings; if it sits behind a tunnel or proxy, allow " +
                "non-localhost requests (Ollama: serve with OLLAMA_HOST=0.0.0.0 or enable " +
                "network exposure). See SELF_HOSTING.md."
            : `${vendorLabel} rejected the API key — check it in settings.`,
        );
      }
      // The response body usually names the actual problem (e.g. Google's
      // 404 body says which model is unavailable) — the status alone doesn't.
      let errorJson: unknown = null;
      try {
        errorJson = response.json;
      } catch {
        // Non-JSON error body; the status code is all we have.
      }
      const apiMessage = extractLlmErrorMessage(errorJson);
      throw new Error(
        `${vendorLabel} request failed (HTTP ${response.status})` +
          (apiMessage ? `: ${apiMessage}` : "."),
      );
    }

    let json: unknown;
    try {
      json = response.json;
    } catch {
      throw new Error(`${vendorLabel} returned an unreadable response.`);
    }

    // Checked before the empty-text case: a truncated response is a different
    // problem than a refused one, and the generic message sends users looking
    // at their key or their ink instead of the output cap.
    if (isTruncatedLlmResponse(cfg.vendor, json)) {
      throw new Error(
        `${vendorLabel} hit InkedMark's ${MAX_OUTPUT_TOKENS}-token output limit before ` +
          "finishing, so the transcription was cut off and discarded. Recognize a smaller " +
          "selection, or pick a model that does not spend its output budget on reasoning.",
      );
    }

    const text = cleanTranscription(extractLlmText(cfg.vendor, json));
    if (!text) throw new Error(`${vendorLabel} returned no transcription.`);
    return { text, confidence: 0.9 };
  }
}
