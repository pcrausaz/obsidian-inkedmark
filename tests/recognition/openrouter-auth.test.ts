import { describe, expect, it } from "vitest";
import {
  OPENROUTER_CALLBACK_ACTION,
  buildKeyExchangeRequest,
  buildOpenRouterAuthUrl,
  codeChallenge,
  extractOpenRouterKey,
  generateCodeVerifier,
} from "../../src/recognition/openrouter-auth";

describe("generateCodeVerifier", () => {
  it("produces 43 base64url characters (32 bytes, no padding)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a different value each time", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe("codeChallenge", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    const challenge = await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("buildOpenRouterAuthUrl", () => {
  it("targets openrouter.ai/auth with the callback, challenge, and S256 method", () => {
    const url = new URL(buildOpenRouterAuthUrl("test-challenge"));
    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("callback_url")).toBe(`obsidian://${OPENROUTER_CALLBACK_ACTION}`);
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("buildKeyExchangeRequest", () => {
  it("posts the code, verifier, and method to the auth/keys endpoint", () => {
    const req = buildKeyExchangeRequest("the-code", "the-verifier");
    expect(req.url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.body).toEqual({
      code: "the-code",
      code_verifier: "the-verifier",
      code_challenge_method: "S256",
    });
  });
});

describe("extractOpenRouterKey", () => {
  it("reads the key from a well-formed response", () => {
    expect(extractOpenRouterKey({ key: "sk-or-v1-abc" })).toBe("sk-or-v1-abc");
  });

  it("returns empty string on malformed payloads", () => {
    expect(extractOpenRouterKey(null)).toBe("");
    expect(extractOpenRouterKey("string")).toBe("");
    expect(extractOpenRouterKey({})).toBe("");
    expect(extractOpenRouterKey({ key: 42 })).toBe("");
  });
});
