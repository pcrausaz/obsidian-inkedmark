# Plan: iPad → Ollama on pMBPM1 (over Tailscale)

## Context
Pascal wants to reach the Ollama server running on **pMBPM1** (his MacBook Pro M1)
from his **iPad**, from anywhere (roaming). He already has **Tailscale** configured
on both devices. He asked whether this configuration should be tracked in this repo
(`liqpil-services-infra`).

## Conclusion: no changes to this repository

There is **nothing to implement here**. The decision:

- **Access method:** Tailscale (already in place), **not** a Cloudflare Tunnel.
  Ollama is unauthenticated; the tailnet keeps it entirely off the public internet
  and works while the iPad roams — solving auth for free. A public CF tunnel would
  require bolting on Cloudflare Access to reach the same security.
- **Tailscale is not managed in this repo** — correct instinct. The client is a
  native app + device login; the only "as-code" surface (tailnet ACLs / auth keys)
  lives in the Tailscale admin console, and if ever version-controlled belongs in a
  separate Tailscale-policy repo, not this NAS+VPS+Cloudflare IaC.
- **No documentation note** in the repo either — Pascal declined it.

So: this repo is unchanged. The steps below are Mac-side reference only, not repo work.

## Mac-side reference (do on pMBPM1, outside this repo)
1. Expose Ollama beyond localhost (it defaults to `127.0.0.1:11434`):
   - Recent Ollama.app: enable the "allow network connections" setting, **or**
   - `launchctl setenv OLLAMA_HOST "0.0.0.0:11434"` then quit & reopen Ollama.app.
     (`0.0.0.0` also relaxes Ollama's Host-header rebind check to accept remote calls.)
2. On the iPad, point an Ollama-compatible client (e.g. Enchanted) at the MagicDNS
   name: `http://pmbpm1.<tailnet>.ts.net:11434`.
3. Optional hardening (tailnet-only, TLS, no home-LAN exposure): keep Ollama on
   localhost and run `tailscale serve --bg 11434`. Caveat: Serve rewrites the Host
   header to the ts.net name, which Ollama's rebind check may 403 — if so, keep
   `OLLAMA_HOST=0.0.0.0` set. Start simple; add Serve only if LAN exposure matters.

## Verification
From the iPad (on cellular, to prove roaming): the client connects and lists models,
or `https://pmbpm1.<tailnet>.ts.net/api/tags` returns the model list.

## Files changed in this repo
None.
