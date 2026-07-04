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
(the OpenRouter vendor makes this easy) to see the quality ceiling, then try
the same pages against your local model and decide whether the difference is
acceptable for _your_ handwriting.

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

Two things to know:

1. `localhost` on the iPad is the iPad itself — you need a URL that reaches
   the machine running the model.
2. Plain-HTTP URLs (`http://192.168.1.10:11434/v1`) often fail on iOS, which
   expects TLS for app network traffic. Use HTTPS.

The two easy paths, in order of preference:

### Tailscale (private, no exposed ports)

1. Install [Tailscale](https://tailscale.com) on the server and on the iPad
   (same tailnet).
2. On the server, put TLS in front of Ollama:

   ```sh
   tailscale serve --bg 11434
   ```

3. Use the HTTPS URL Tailscale prints (e.g.
   `https://yourbox.your-tailnet.ts.net/v1`) as the endpoint URL in InkedMark.

Nothing is exposed to the public internet; only devices on your tailnet can
reach the server.

### Cloudflare Tunnel (public URL, no port forwarding)

1. Create a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
   (`cloudflared`) on the server, routing a hostname you own (e.g.
   `ollama.example.com`) to `http://localhost:11434`.
2. Use `https://ollama.example.com/v1` as the endpoint URL.
3. **Add an access policy** (Cloudflare Access) or at minimum an API key on
   the server — a bare tunnel makes your model server reachable by anyone who
   finds the hostname.

## Troubleshooting

- **"could not reach …"** — the server isn't running, or the URL isn't
  reachable from this device (see the iPad section above).
- **HTTP 404** — the endpoint URL is missing its `/v1` segment (Ollama and
  LM Studio both use one).
- **Empty or nonsense transcriptions** — the model isn't vision-capable, or
  it's too small for handwriting. Try `qwen2.5vl:7b` or larger, and re-read
  the quality expectations above.
