# OCR Strategy: Self-Host Endpoint + OpenRouter One-Click Connect

## Context

On-device TrOCR is desktop-only (`src/recognition/trocr.ts:166-171` hard-blocks mobile) and the BYOK cloud path has two adoption blockers for the average user: API-key friction and data-privacy concern. Strategy decision from this session's analysis:

- **Build now:** (A) custom OpenAI-compatible endpoint → self-hosting path (Ollama/LM Studio/vLLM/llama.cpp), (B) OpenRouter OAuth PKCE one-click connect → removes key copy/paste, (C) honest self-hosting docs.
- **Deferred:** hosted resell service (doesn't fix data concern, adds billing/abuse/GDPR burden — per SPECIFICATION.md:591-610, revisit once BYOK demand proven); on-device iPad (iOS/iPadOS 26 ships WebGPU **enabled by default in WKWebView**, so the `trocr.ts` block is now version-dependent — revisit as install base grows).
- **Honesty constraint (user-mandated):** docs must state clearly that local 7–8B VLMs are acceptable on neat/printed handwriting but unreliable on cursive; cloud frontier models are clearly better today.
- **Visibility constraint (user-mandated):** work stays on a **local-only branch, never pushed** to the public GitHub repo until the user decides to publish.

## Step 0 — Branch (local only)

`git switch -c feat/self-host-and-openrouter-connect` — **no `git push` at any point**. A plain local branch suffices (nothing is visible on GitHub until pushed); no worktree needed unless main must stay checked out for parallel work.

## Feature A — Custom OpenAI-compatible endpoint

Key decisions: new `"custom"` member of the `LlmVendor` union (not a base-URL override on existing vendors — keeps named-vendor semantics intact); API key optional for custom (Ollama needs none); no auto-`/v1` — placeholder text shows `http://localhost:11434/v1`; settings merge via `Object.assign({}, DEFAULT_SETTINGS, data)` (`main.ts:173-176`) means no migration code.

1. **`src/recognition/llm-request.ts`** (pure — do first, with tests):
   - Add `"custom"` to `LlmVendor` (line 12), `VENDOR_LABELS` ("Custom endpoint (OpenAI-compatible)") — settings dropdown iterates this record, so UI option appears automatically — and `DEFAULT_MODELS` (`qwen2.5vl:7b`).
   - `LlmRequestInput` gains `baseUrl?: string`.
   - New pure helpers: `chatCompletionsUrl(baseUrl)` (trim, strip trailing slash, append `/chat/completions` unless already present, throw on non-http(s)/unparseable) and `describeLlmTarget(vendor, baseUrl?)` (vendor label, or `your configured endpoint (<host>)` for custom).
   - `buildLlmRequest`: fold `custom` into the existing OpenAI-dialect branch (lines 103-134): URL from `chatCompletionsUrl`, no OpenRouter attribution headers, `authorization` header only when key non-empty; relax the top-of-function missing-key throw (line 70) for `custom` only.
   - `extractLlmText` (line 177): treat `custom` like openai/openrouter.
2. **`src/recognition/llm.ts`**: `LlmProviderConfig` gains `baseUrl`; skip key guard for custom, instead require baseUrl; try/catch `requestUrl` for custom to produce "could not reach <host> — is the server running and reachable from this device?"; use `describeLlmTarget` in error messages. (Transport already `requestUrl` — bypasses CORS on desktop and mobile; keep.)
3. **`src/settings.ts`**: add `llmBaseUrl: string` (default `""`) to `InkedMarkSettings` + `DEFAULT_SETTINGS`; when vendor=custom render "Endpoint URL" field after the vendor dropdown (~line 230) with a warning callout (reuse `inkedmark-callout` pattern from settings.ts:88-99) when URL starts with `http://`: plain-HTTP often fails on iPhone/iPad — use `tailscale serve` or a Cloudflare Tunnel for HTTPS; API-key desc for custom: "optional — most self-hosted servers don't need one".
4. **`src/main.ts`**: `getConfig` closure (lines 60-64) passes `baseUrl`; consent modal (line 210) uses `describeLlmTarget` with adjusted copy for custom ("…sends it to your configured endpoint (<host>). If that server is yours, the ink stays under your control."). Keep single global `cloudConsentGiven`.
5. **`tests/recognition/llm-request.test.ts`** (vitest, `npm test`): custom URL building (trailing slash, already-appended path, garbage URL throws); no auth header when key empty / Bearer when set; no attribution headers; `extractLlmText("custom", …)`; `describeLlmTarget`; extend the DEFAULT_MODELS loop.

## Feature B — OpenRouter one-click connect (OAuth PKCE)

Flow: settings button → generate `code_verifier` → open `https://openrouter.ai/auth?callback_url=obsidian://inkedmark-openrouter&code_challenge=<S256>&code_challenge_method=S256` in system browser → user approves on openrouter.ai → browser redirects to `obsidian://inkedmark-openrouter?code=…` → plugin exchanges code at `POST https://openrouter.ai/api/v1/auth/keys` (`{code, code_verifier, code_challenge_method}`) → stores returned user-scoped key in `llmApiKey`, forces `llmVendor="openrouter"`, success notice.

Key decisions: pending verifier **in memory only** on the plugin instance (never persisted — avoids syncing a secret; if app is evicted mid-flow the user just clicks Connect again); protocol action `inkedmark-openrouter` (global namespace — prefix with plugin id); button rendered only when vendor=openrouter ("Connect OpenRouter" / "Reconnect" when key exists).

1. **New `src/recognition/openrouter-auth.ts`** (pure, mirrors the llm-request/llm split): `generateCodeVerifier()` (32 bytes `crypto.getRandomValues`, base64url), `codeChallenge(verifier)` (WebCrypto SHA-256, base64url), `buildOpenRouterAuthUrl(challenge)`, `buildKeyExchangeRequest(code, verifier)`, `extractOpenRouterKey(json)`, `OPENROUTER_CALLBACK_ACTION` const.
2. **`src/main.ts`**: fields `pendingOpenRouterVerifier` + settings-tab ref; `startOpenRouterConnect()` (store verifier, `window.open(authUrl)`); `handleOpenRouterCallback(params)` — no `code` → failure notice; no pending verifier → "open settings and click Connect again" notice; exchange via `requestUrl` `{throw:false}`, non-2xx or missing key → notice with status, clear verifier; success → save settings, notice, re-render settings tab if `containerEl.isConnected`. Register handler in `onload()` after `addSettingTab` via `registerObsidianProtocolHandler`.
3. **`src/settings.ts`**: CTA button in the Cloud AI block when vendor=openrouter, desc: "Creates a user-scoped API key in your browser — no copy/paste. You approve it on openrouter.ai."
4. **New `tests/recognition/openrouter-auth.test.ts`**: verifier length/charset/uniqueness; RFC 7636 test vector (`dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`); auth-URL params incl. encoded callback; exchange request shape; key extraction edge cases. Add the new module to the vitest coverage `include` list (`vitest.config.ts`).

## Feature C — Documentation

Prose docs live at repo root (`docs/` is the GitHub Pages site). 

1. **New `SELF_HOSTING.md`** (root): what it is (ink never leaves your network); Ollama quickstart (`ollama pull qwen2.5vl:7b`, endpoint `http://localhost:11434/v1`, key blank); LM Studio / llama.cpp / vLLM one-liners; **iPad remote access** via Tailscale + `tailscale serve` (TLS, recommended) or Cloudflare Tunnel, with explicit note that `localhost` on the iPad is the iPad; hardware expectations (7-8B ≈ 6–10 GB RAM/VRAM, seconds-to-tens-of-seconds per page vs ~1–3 s cloud); **prominent "Quality expectations" section**: local models OK on neat/printed handwriting, unreliable on cursive and dense math — try a cloud model first to see the ceiling, then decide.
2. **`README.md`**: extend Cloud AI bullet (README.md:69-76) with Custom endpoint + link to SELF_HOSTING.md and one line on Connect OpenRouter; update Network use disclosure (README.md:92-102): case (1) gains "or the custom endpoint URL you configured"; new case for the OAuth exchange ("nothing is sent until you approve in the browser").

## Housekeeping (after plan approval, before/alongside code)

1. **Auto-memory**: add `ocr-strategy-2026-07.md` (type: project) — decision above, iOS 26 WKWebView WebGPU fact, local-model quality caveat, and the do-not-push-until-user-decides constraint for this branch; link from MEMORY.md and [[inkedmark-release-status]].
2. **Project `CLAUDE.md`** (none exists): thin, public-safe map only — commands (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run format:check`), architecture pointers (recognition provider seam in `src/recognition/provider.ts`, pure-builder-vs-IO convention `llm-request.ts`/`llm.ts`, text-layer markers, settings merge pattern), pointer to SPECIFICATION.md/QA.md/RELEASE.md. No duplication of README/SPECIFICATION content; nothing about private workflow (repo is public).

## Implementation order

Branch → A1 pure + tests (`npm test`) → A2-A4 wiring (`npm run typecheck && npm run lint`) → B1 pure + tests → B2-B3 wiring → C docs → CLAUDE.md + memory → `npm run build` + `npm run format:check` → commit(s) locally, no push.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all green.
- Desktop (macOS): custom vendor against local Ollama (`qwen2.5vl:7b`) returns a transcription; consent modal names the endpoint host; wrong port → clear "could not reach" error; trailing-slash and pre-appended `/chat/completions` URLs both work; empty key OK (Ollama); existing 4 vendors still work; pre-upgrade `data.json` loads cleanly.
- Desktop OAuth: Connect → browser → approve → key populated, vendor=openrouter, recognition works; cancel is harmless; `obsidian://inkedmark-openrouter?code=xyz` with no pending connect → clean notice.
- iPad: custom endpoint over `tailscale serve` HTTPS works; record whether plain `http://<LAN-IP>` is blocked (warning shows either way); OAuth round-trip returns to Obsidian and stores the key (also test after backgrounding to exercise lost-verifier path); settings render sanely on the mobile pane.
- `git log origin/main..HEAD` shows the work; `git ls-remote --heads origin` confirms the branch was never pushed.
