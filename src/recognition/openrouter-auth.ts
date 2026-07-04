/**
 * Pure helpers for the OpenRouter one-click connect flow (OAuth 2.0 PKCE,
 * RFC 7636). The plugin opens the user's browser on openrouter.ai, the user
 * approves, and OpenRouter redirects back to `obsidian://inkedmark-openrouter`
 * with a one-time code that is exchanged for a user-scoped API key. No DOM,
 * no Obsidian, no network — the IO lives in `main.ts`.
 */

/** Obsidian protocol action (the namespace is global across plugins, hence the prefix). */
export const OPENROUTER_CALLBACK_ACTION = "inkedmark-openrouter";

const CALLBACK_URL = `obsidian://${OPENROUTER_CALLBACK_ACTION}`;

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url — the PKCE code verifier. */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return uint8ToBase64Url(bytes);
}

/** base64url(SHA-256(verifier)) — the S256 code challenge. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return uint8ToBase64Url(new Uint8Array(digest));
}

/** Browser URL where the user approves the connection. */
export function buildOpenRouterAuthUrl(challenge: string): string {
  const params = new URLSearchParams({
    callback_url: CALLBACK_URL,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://openrouter.ai/auth?${params.toString()}`;
}

export interface KeyExchangeRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** POST request that trades the one-time code for a user-scoped API key. */
export function buildKeyExchangeRequest(code: string, verifier: string): KeyExchangeRequest {
  return {
    url: "https://openrouter.ai/api/v1/auth/keys",
    headers: { "content-type": "application/json" },
    body: { code, code_verifier: verifier, code_challenge_method: "S256" },
  };
}

/** Extract the API key from the exchange response, or "" if absent. */
export function extractOpenRouterKey(json: unknown): string {
  if (typeof json !== "object" || json === null) return "";
  const key = (json as Record<string, unknown>).key;
  return typeof key === "string" ? key : "";
}
