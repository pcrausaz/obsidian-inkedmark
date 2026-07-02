/**
 * Pure request/response shapes for the BYOK cloud recognition provider (§7).
 *
 * Builds vendor-specific HTTP requests (Anthropic / OpenAI / Google) that send
 * a rendered PNG of the ink plus a transcription prompt, and extracts the
 * transcribed text from each vendor's response JSON. No DOM, no Obsidian, no
 * network — the IO lives in `llm.ts`.
 */

export const LLM_PROVIDER_ID = "llm-byok";

export type LlmVendor = "anthropic" | "openai" | "google";

export const VENDOR_LABELS: Record<LlmVendor, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
};

/** Editable in settings; these are only the starting points. */
export const DEFAULT_MODELS: Record<LlmVendor, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o-mini",
  google: "gemini-2.5-flash",
};

/** Output budget for a page transcription. */
const MAX_OUTPUT_TOKENS = 2048;

export function defaultModelFor(vendor: LlmVendor): string {
  return DEFAULT_MODELS[vendor];
}

/** Markdown-focused transcription prompt (§7: text must be markdown-ready). */
export function buildRecognitionPrompt(hint?: string, locale?: string): string {
  const lines = [
    "Transcribe ALL handwritten content in this image into clean markdown.",
    "Rules:",
    "- Output ONLY the transcription - no preamble, no commentary, no code fences.",
    "- Preserve the writing's line structure; use markdown lists or headings only where the writing clearly implies them.",
    "- Keep [[wiki-links]] and #tags exactly as written.",
    "- Use $...$ LaTeX for mathematical notation.",
    "- For drawings or diagrams, insert a short bracketed description like [sketch: flow diagram].",
    "- If a word is illegible, write your best guess followed by (?).",
  ];
  if (hint === "math") lines.push("- The content is primarily mathematical notation.");
  if (locale) lines.push(`- The handwriting is most likely in this language/locale: ${locale}.`);
  return lines.join("\n");
}

export interface LlmRequestInput {
  vendor: LlmVendor;
  model: string;
  apiKey: string;
  /** PNG image, base64 without a data-URL prefix. */
  imageBase64: string;
  prompt: string;
}

export interface LlmHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Build the vendor-specific HTTP request. Throws if the API key is missing. */
export function buildLlmRequest(input: LlmRequestInput): LlmHttpRequest {
  if (!input.apiKey.trim()) throw new Error("missing API key");

  switch (input.vendor) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: {
          model: input.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: input.imageBase64,
                  },
                },
                { type: "text", text: input.prompt },
              ],
            },
          ],
        },
      };

    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: {
          model: input.model,
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${input.imageBase64}` },
                },
                { type: "text", text: input.prompt },
              ],
            },
          ],
        },
      };

    case "google":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          input.model,
        )}:generateContent`,
        headers: {
          "x-goog-api-key": input.apiKey,
          "content-type": "application/json",
        },
        body: {
          contents: [
            {
              parts: [
                { inline_data: { mime_type: "image/png", data: input.imageBase64 } },
                { text: input.prompt },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
        },
      };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extract the transcription text from a vendor response, or "" if absent. */
export function extractLlmText(vendor: LlmVendor, json: unknown): string {
  if (!isRecord(json)) return "";

  if (vendor === "anthropic") {
    const content = json.content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((b): b is { type: string; text: string } => isRecord(b) && b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  if (vendor === "openai") {
    const choices = json.choices;
    if (!Array.isArray(choices) || !isRecord(choices[0])) return "";
    const message = choices[0].message;
    if (!isRecord(message) || typeof message.content !== "string") return "";
    return message.content;
  }

  // google
  const candidates = json.candidates;
  if (!Array.isArray(candidates) || !isRecord(candidates[0])) return "";
  const content = candidates[0].content;
  if (!isRecord(content) || !Array.isArray(content.parts)) return "";
  return content.parts
    .filter((p): p is { text: string } => isRecord(p) && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/** Normalize model output: trim and unwrap a single accidental code fence. */
export function cleanTranscription(text: string): string {
  let out = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(out);
  if (fence) out = fence[1].trim();
  return out;
}
