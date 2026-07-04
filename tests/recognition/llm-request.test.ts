import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODELS,
  buildLlmRequest,
  buildRecognitionPrompt,
  chatCompletionsUrl,
  cleanTranscription,
  defaultModelFor,
  describeLlmTarget,
  extractLlmText,
} from "../../src/recognition/llm-request";

const base = { model: "test-model", apiKey: "sk-test", imageBase64: "AAAA", prompt: "transcribe" };

describe("buildLlmRequest", () => {
  it("throws on a missing API key", () => {
    expect(() => buildLlmRequest({ ...base, vendor: "anthropic", apiKey: " " })).toThrow(/API key/);
  });

  it("builds an Anthropic messages request (image block before text)", () => {
    const req = buildLlmRequest({ ...base, vendor: "anthropic" });
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-test");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    const body = req.body as {
      model: string;
      max_tokens: number;
      messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages[0].content[0].type).toBe("image");
    expect(body.messages[0].content[0].source?.data).toBe("AAAA");
    expect(body.messages[0].content[1].type).toBe("text");
  });

  it("builds an OpenAI chat completions request with a data URL", () => {
    const req = buildLlmRequest({ ...base, vendor: "openai" });
    expect(req.url).toContain("api.openai.com");
    expect(req.headers.authorization).toBe("Bearer sk-test");
    const body = req.body as {
      messages: Array<{ content: Array<{ image_url?: { url: string } }> }>;
    };
    expect(body.messages[0].content[0].image_url?.url).toBe("data:image/png;base64,AAAA");
  });

  it("builds an OpenRouter request on the OpenAI dialect with attribution headers", () => {
    const req = buildLlmRequest({ ...base, vendor: "openrouter" });
    expect(req.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(req.headers.authorization).toBe("Bearer sk-test");
    expect(req.headers["x-title"]).toBe("InkedMark");
    const body = req.body as {
      messages: Array<{ content: Array<{ image_url?: { url: string } }> }>;
    };
    expect(body.messages[0].content[0].image_url?.url).toBe("data:image/png;base64,AAAA");
    // Response extraction uses the OpenAI shape too.
    const json = { choices: [{ message: { content: "via openrouter" } }] };
    expect(extractLlmText("openrouter", json)).toBe("via openrouter");
  });

  it("builds a custom-endpoint request on the OpenAI dialect without attribution headers", () => {
    const req = buildLlmRequest({
      ...base,
      vendor: "custom",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(req.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(req.headers.authorization).toBe("Bearer sk-test");
    expect(req.headers["x-title"]).toBeUndefined();
    expect(req.headers["http-referer"]).toBeUndefined();
    const body = req.body as {
      messages: Array<{ content: Array<{ image_url?: { url: string } }> }>;
    };
    expect(body.messages[0].content[0].image_url?.url).toBe("data:image/png;base64,AAAA");
    // Response extraction uses the OpenAI shape too.
    const json = { choices: [{ message: { content: "via ollama" } }] };
    expect(extractLlmText("custom", json)).toBe("via ollama");
  });

  it("allows an empty API key for the custom vendor (no authorization header)", () => {
    const req = buildLlmRequest({
      ...base,
      vendor: "custom",
      apiKey: "",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers["content-type"]).toBe("application/json");
  });

  it("still requires an API key for named vendors", () => {
    expect(() => buildLlmRequest({ ...base, vendor: "openrouter", apiKey: "" })).toThrow(/API key/);
  });

  it("builds a Google generateContent request with the model in the URL", () => {
    const req = buildLlmRequest({ ...base, vendor: "google" });
    expect(req.url).toContain("generativelanguage.googleapis.com");
    expect(req.url).toContain("test-model:generateContent");
    expect(req.headers["x-goog-api-key"]).toBe("sk-test");
    const body = req.body as {
      contents: Array<{ parts: Array<{ inline_data?: { data: string } }> }>;
    };
    expect(body.contents[0].parts[0].inline_data?.data).toBe("AAAA");
  });
});

describe("chatCompletionsUrl", () => {
  it("appends /chat/completions to the base URL", () => {
    expect(chatCompletionsUrl("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });

  it("strips trailing slashes and surrounding whitespace", () => {
    expect(chatCompletionsUrl("  https://ollama.example.com/v1//  ")).toBe(
      "https://ollama.example.com/v1/chat/completions",
    );
  });

  it("does not double-append when the path is already complete", () => {
    expect(chatCompletionsUrl("http://localhost:1234/v1/chat/completions")).toBe(
      "http://localhost:1234/v1/chat/completions",
    );
  });

  it("throws on unparseable or non-http(s) URLs", () => {
    expect(() => chatCompletionsUrl("")).toThrow(/endpoint URL/);
    expect(() => chatCompletionsUrl("localhost:11434")).toThrow(/endpoint URL/);
    expect(() => chatCompletionsUrl("ftp://example.com")).toThrow(/http/);
  });
});

describe("describeLlmTarget", () => {
  it("returns the vendor label for named vendors", () => {
    expect(describeLlmTarget("anthropic")).toBe("Anthropic (Claude)");
    expect(describeLlmTarget("openrouter")).toBe("OpenRouter (any model)");
  });

  it("names the configured host for the custom vendor", () => {
    expect(describeLlmTarget("custom", "http://192.168.1.10:11434/v1")).toBe(
      "your configured endpoint (192.168.1.10:11434)",
    );
  });

  it("degrades gracefully when the custom URL is missing or invalid", () => {
    expect(describeLlmTarget("custom")).toBe("your configured endpoint");
    expect(describeLlmTarget("custom", "not a url")).toBe("your configured endpoint");
  });
});

describe("extractLlmText", () => {
  it("extracts Anthropic text blocks", () => {
    const json = {
      content: [
        { type: "text", text: "line one" },
        { type: "tool_use", id: "x" },
        { type: "text", text: "line two" },
      ],
    };
    expect(extractLlmText("anthropic", json)).toBe("line one\nline two");
  });

  it("extracts OpenAI message content", () => {
    const json = { choices: [{ message: { role: "assistant", content: "hello" } }] };
    expect(extractLlmText("openai", json)).toBe("hello");
  });

  it("extracts Google candidate parts", () => {
    const json = { candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] };
    expect(extractLlmText("google", json)).toBe("ab");
  });

  it("returns empty string on malformed payloads", () => {
    expect(extractLlmText("anthropic", null)).toBe("");
    expect(extractLlmText("openai", { choices: [] })).toBe("");
    expect(extractLlmText("google", { candidates: [{}] })).toBe("");
  });
});

describe("prompt & cleanup", () => {
  it("prompt includes markdown rules and optional locale", () => {
    const prompt = buildRecognitionPrompt(undefined, "fr-CH");
    expect(prompt).toMatch(/markdown/i);
    expect(prompt).toContain("[[wiki-links]]");
    expect(prompt).toContain("fr-CH");
  });

  it("cleanTranscription unwraps an accidental code fence", () => {
    expect(cleanTranscription("```markdown\n# Title\ntext\n```")).toBe("# Title\ntext");
    expect(cleanTranscription("  plain text  ")).toBe("plain text");
  });

  it("has a default model per vendor", () => {
    for (const vendor of ["anthropic", "openai", "google", "openrouter", "custom"] as const) {
      expect(defaultModelFor(vendor)).toBe(DEFAULT_MODELS[vendor]);
      expect(DEFAULT_MODELS[vendor].length).toBeGreaterThan(0);
    }
  });
});
