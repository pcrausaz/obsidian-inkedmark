# Self-hosting handwriting recognition

InkedMark's **Custom endpoint** vendor points Cloud AI recognition at any
OpenAI-compatible server you run yourself — your ink is rendered to an image
and sent to _your_ machine instead of a cloud provider, so it never leaves
your own network. This guide covers the common setups.

> **Read the [quality expectations](#quality-expectations-read-this-first)
> section first.** Self-hosting trades recognition quality for privacy, and
> the trade is real.

## Quality expectations (read this first)

Be honest with yourself about what local models can do today:

- **Neat or printed handwriting**: current local vision models in the 7–8B
  class (Qwen2.5-VL 7B, Qwen3-VL 8B, MiniCPM-V) transcribe it acceptably —
  usable output with occasional wrong words.
- **Cursive, messy, or dense handwriting**: unreliable on _all_ local models
  we have tested or seen benchmarked. Expect dropped lines, hallucinated
  words, and garbled math.
- **Cloud frontier models** (Claude, GPT, Gemini) are clearly better on
  handwriting today. That gap is shrinking, but it exists.

A practical approach: run a few of your own pages through a cloud model first
to see the quality ceiling, then try the same pages against your local model
and decide whether the difference is acceptable for _your_ handwriting. The
easiest cloud setup is the **OpenRouter** vendor with its **Connect
OpenRouter** button — one click, approved in your browser, no API key to
copy. (That path is cloud recognition, unrelated to the self-hosting setup
below.)

## What you need

- A machine that can run a 7–8B vision model: roughly **6–10 GB of free
  RAM/VRAM** (a 16 GB Apple Silicon Mac is comfortable; an 8 GB GPU works with
  quantized models). A GPU-less VPS is generally too slow to be pleasant.
- Expect **seconds to tens of seconds per page** locally, versus ~1–3 s for
  cloud models.

## Option 1 — Ollama (recommended)

1. Install [Ollama](https://ollama.com) on the machine that will do the work.
2. Pull a vision model:

   ```sh
   ollama pull qwen2.5vl:7b
   ```

   (`qwen3-vl` variants work too where available; smaller tags like
   `qwen2.5vl:3b` are faster and noticeably worse.)

3. Ollama serves an OpenAI-compatible API at `http://localhost:11434/v1`.
4. In InkedMark settings: **Handwriting recognition → Cloud AI**, vendor
   **Custom endpoint (OpenAI-compatible)**, endpoint URL
   `http://localhost:11434/v1`, model `qwen2.5vl:7b`, API key **blank**.

## Option 2 — LM Studio and friends

- **LM Studio**: load a vision model, enable the local server (Developer tab);
  the endpoint is `http://localhost:1234/v1`.
- **llama.cpp** (`llama-server`), **vLLM**, and **LocalAI** all expose the
  same OpenAI-compatible `/v1` API and work identically — set the endpoint
  URL, the model name the server expects, and a key only if the server
  requires one.

## Reaching your server from an iPad

Three things to know:

1. `localhost` on the iPad is the iPad itself — you need a URL that reaches
   the machine running the model.
2. Plain-HTTP URLs (`http://192.168.1.10:11434/v1`) often fail on iOS, which
   expects TLS for app network traffic. Use HTTPS.
3. **Ollama only answers requests addressed to `localhost` by default.**
   Through a tunnel or proxy the hostname differs, so Ollama returns an empty
   HTTP 403 even though the tunnel works. The check is skipped when the
   server binds a non-loopback address, so run a network-facing server on a
   second port (the desktop app's own server stays untouched):

   ```sh
   OLLAMA_HOST=0.0.0.0:11500 ollama serve
   ```

   and point the tunnel at port 11500. Some Ollama desktop builds have an
   “Expose Ollama to the network” setting that does the same; the
   menu-bar-only macOS app has no settings UI. Two caveats: binding
   `0.0.0.0` also makes the port reachable from your LAN (your firewall
   governs that), and on macOS do **not** bind the machine's own Tailscale
   IP instead — the Tailscale proxy cannot hairpin to it and requests hang.

The two easy paths, in order of preference:

### Tailscale (private, no exposed ports)

1. Install [Tailscale](https://tailscale.com) on the server and on the iPad
   (same tailnet).
2. On the server, run a network-facing Ollama (see point 3 above):

   ```sh
   OLLAMA_HOST=0.0.0.0:11500 ollama serve
   ```

3. Put TLS in front of it:

   ```sh
   tailscale serve --bg 11500
   ```

4. Use the HTTPS URL Tailscale prints (e.g.
   `https://yourbox.your-tailnet.ts.net/v1`) as the endpoint URL in InkedMark.

The HTTPS URL is reachable only from your tailnet, not the public internet.

#### Running the server only when you need it

If you use local recognition occasionally (say, for testing) rather than
daily, skip the always-on setup and manage the server by hand:

- **Start** (survives closing the terminal; dies at reboot/logout):

  ```sh
  nohup env OLLAMA_HOST=0.0.0.0:11500 ollama serve \
    > ~/Library/Logs/ollama-tailnet.log 2>&1 & disown
  ```

- **Stop**: `kill $(lsof -tnP -iTCP:11500 -sTCP:LISTEN)`
- **Check**: `curl http://localhost:11500/api/version` (or the tailnet HTTPS
  URL from the client device).
- The `tailscale serve` mapping can stay configured while the server is
  down — clients just get a 502 until you start it again, and InkedMark
  reports "could not reach your configured endpoint".

To keep the step-2 server running across reboots instead, wrap it in a launchd agent
(macOS): save this as `~/Library/LaunchAgents/local.ollama-tailnet.plist`,
then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.ollama-tailnet.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.ollama-tailnet</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/ollama</string><string>serve</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>OLLAMA_HOST</key><string>0.0.0.0:11500</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

### Cloudflare Tunnel (public URL, no port forwarding)

1. Create a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   (`cloudflared`) on the server, routing a hostname you own (e.g.
   `ollama.example.com`) to `http://localhost:11434`.
2. Use `https://ollama.example.com/v1` as the endpoint URL.
3. **Add an access policy** (Cloudflare Access) or at minimum an API key on
   the server — a bare tunnel makes your model server reachable by anyone who
   finds the hostname.

## Troubleshooting

- **"invalid endpoint URL"** — enter the full URL including the scheme and
  the `/v1` path, e.g. `https://yourbox.your-tailnet.ts.net/v1` — a bare
  hostname is not enough. The settings field flags this as you type.
- **"denied the request (HTTP 403)" through Tailscale/Cloudflare** — this is
  Ollama's localhost-only protection, not an API-key problem: run a
  network-facing server (`OLLAMA_HOST=0.0.0.0:11500 ollama serve`, see the
  iPad section above) and point the tunnel at it, then retry.
- **"could not reach …"** — the server isn't running, or the URL isn't
  reachable from this device (see the iPad section above).
- **HTTP 404** — the endpoint URL is missing its `/v1` segment (Ollama and
  LM Studio both use one).
- **Empty or nonsense transcriptions** — the model isn't vision-capable, or
  it's too small for handwriting. Try `qwen2.5vl:7b` or larger, and re-read
  the quality expectations above.
