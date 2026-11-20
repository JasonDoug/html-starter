# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Reddit Video Studio": a browser app that turns a Reddit / Hacker News / Guardian post into a short video: scrape → script → voiceover → visuals → assemble → YouTube upload → analytics. Almost everything runs client-side. There is no build step, no bundler, no npm dependencies, and no test suite or linter.
Owner: Jason (Las Vegas). He runs it **locally** via `node server.mjs` (the Vercel deploy is abandoned; `api/` is a leftover that can be removed).

## Working rules
- **Push straight to `main`** unless he explicitly asks for a PR.
- Free services only; keep things browser-native where possible.
- Single-page vanilla JS: almost everything is inline in `index.html`. Check JS syntax after edits (extract the biggest `<script>` and run `node --check`).
- Commit trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never commit secrets (API keys, tokens). Reminders still open: he should revoke a GitHub PAT pasted in an earlier session and rotate the exposed rss2json key.

## Running

```bash
node server.mjs                      # http://localhost:3000 (PORT env to change)
docker compose up -d --build         # same server in a container; reaches host ComfyUI via host.docker.internal
COMFY_URL=http://127.0.0.1:8188 node server.mjs   # image gen; this URL is the default
```

Env vars: `GUARDIAN_API_KEY` (Guardian source), `COMFY_URL`, `MODELS_DIR` (default `/home/jason/models`), `CHECKPOINTS_DIR` (default `$MODELS_DIR/Checkpoints/checkpoints`).

Image-gen utilities (see `imagegen/README.md`):
```bash
node imagegen/bench.mjs [name-substring ...]       # time real generations per model; saves imagegen/timings.json
node imagegen/mock-comfy.mjs <port> <png> [log]    # fake ComfyUI for manual testing; point COMFY_URL at it
node imagegen/scan-models.mjs [MODELS_DIR] [--apply | --link]   # classify .safetensors (dry run by default; never deletes).
                                                   # --apply moves usable checkpoints in, leaving a symlink behind; --link only symlinks
./imagegen/download-models.sh <checkpoints_dir> [--all]
imagegen/setup-hf-cache.sh                         # HF cache setup
```

## Machines / paths
- x1-pro (daily driver, Radeon 890M iGPU, ComfyUI at `/home/jason/AI-ImageGen/ComfyUI`), models root `/home/jason/models` (ComfyUI `extra_model_paths.yaml`: `checkpoints: Checkpoints/checkpoints`).
- Measured there at 576×1024: SDXL-Lightning 2-step 3.1 s, 4-step 4.5 s (default), RealVisXL V5 Lightning 13.2 s; 8-step 12.4 s at 760×1344.

## Architecture

**`index.html` (~2100 lines) is the whole app.** It holds the HTML, CSS and one inline `<script>`, with global state (`selPost`, `script`, `wordTimings`, `curPreset`, `curGenre`, `loadedImages`, `window._assembledBlob`, `window._ytToken`, …) and inline `onclick` handlers. The UI is 7 steps, panels `#p0..#p6` and tabs `#s0..#s6`, switched by `goto(n)`:

1. **Scrape** – `scrape()`. Reddit posts come from the Arctic Shift archive (`/api/arctic`, falling back to a direct fetch). Older paths still exist as fallbacks: `/api/rss` (Atom fetched from the user's own IP) and rss2json. HN and Guardian go through `/api/sources`.
2. **Script** – `genScript()` calls the LLM **directly from the browser** with a user-supplied key. The options are OpenRouter free models (the list is fetched and cached in localStorage, and dead models are skipped) or Anthropic (`anthropic-dangerous-direct-browser-access`). The prompt includes a `GENRES[curGenre].guide` style guide and asks for JSON that includes `image_prompts` (one per beat).
3. **Voice** – Kokoro TTS (`kokoro-js` from jsDelivr, ONNX/wasm, model cached through Cache API or an IndexedDB shim in `ensureModelCache`). It produces `audioBlob` and the `wordTimings` used for captions.
4. **Visuals** – one image per script beat (`getBeats()`). Sources are Wikimedia Commons search → Picsum fallback, or **AI generated** via `/api/imagegen/*` (local server only). One model dropdown lists every usable checkpoint found under the models folder; generation settings follow the model automatically.
5. **Assemble** – `buildRenderState()` + `renderFrame()` draw Ken Burns motion and word-synced captions (Google Fonts, awaited via `ensureCapFont`) to a canvas. `MediaRecorder` records it, and FFmpeg.wasm (unpkg, `loadFFmpeg`) is used during assembly for conversion.
6. **Publish** / 7. **Analytics** – Google Identity Services OAuth in the browser, then YouTube Data API v3 resumable upload and YouTube Analytics API.

User settings (API keys, Google client ID, style, model, last video id) persist in `localStorage`. Every access is wrapped in try/catch, so keep that pattern.

**Server:** `server.mjs` is a dependency-free `node:http` server. It reuses `api/sources.js` (a Vercel-style handler) through a small `shim()` that adds `res.status`/`res.json`. It implements `/api/arctic` inline and adds `/api/rss` (reddit.com-only, 5-min cache, honours 429 `Retry-After` with a global back-off, serves stale on failure) and `/api/imagegen/{health,generate}`. All other paths are served as static files; `api/` and `server.mjs` are blocked. The other `api/*.js` files are Vercel leftovers.

**Image generation (`imagegen/`):**
- `comfy.mjs` is the ComfyUI adapter. It builds an API-format workflow (CheckpointLoaderSimple → CLIPTextEncode ×2 → EmptyLatentImage → KSampler → VAEDecode → SaveImage), POSTs `/prompt`, polls `/history/{id}`, and fetches `/view`. Jobs are queued one at a time.
- `health()` combines ComfyUI's checkpoint list with `discoverModels()`. That walks all of `MODELS_DIR` (following symlinks, so HF cache snapshots count; skipping `blobs/`), dedupes by real path, and classifies each `.safetensors` via `classify.mjs`. Only all-in-one SDXL / SD1 checkpoints are usable. Diffusion-only models (Flux-2-klein, Z-Image-Turbo), LoRAs and VAEs need a different workflow (not built). A usable model outside `CHECKPOINTS_DIR` is symlinked in on first use (`linkIntoCheckpoints`).
- Generation settings come from `profileFor()`: the first `profiles` entry in `presets.json` whose `match` regex hits the filename, else `fallback[sdxl|sd1]`. Profiles can set clip skip (adds a CLIPSetLastLayer node) and prompt/negative prefixes. `dimensions()` derives width/height from the profile's `long` edge and the aspect.
- Warm generation times are recorded per model in `timings.json` (gitignored) and shown in the dropdown; the run right after a model switch is excluded.

## Key facts learned (don't re-discover)
- Reddit ended RSS (Nov 13 2026) and unauthenticated JSON. Posts come from the **Arctic Shift archive** (`arctic-shift.photon-reddit.com/api/posts/search`), newest-first, 100 per call, no score sort. "Top" slices the time window into several calls and ranks by score client-side. Time-of-day `after`/`before` bounds are unverified live (falls back to date-only). PRAW no longer works for him.
- Voiceover: Kokoro TTS in the browser (Web Speech cannot be recorded). Word timings are estimated per sentence.
- Assembly: canvas + AudioContext → MediaRecorder (MP4 if supported else WebM), FFmpeg.wasm only to convert when needed.
- Caption fonts must be web fonts (Google Fonts link in `<head>`); system fonts like Impact don't exist on his Linux box.
- Wikimedia Commons only serves standard thumbnail widths (other widths → HTTP 429).
- Google sign-in: GIS `initTokenClient`; needs an exact https origin (Cloudflare tunnel) registered, Web application client type. Tokens last ~1h, no auto-refresh yet.
- YouTube Analytics API lags Studio by 1-3 days and has no "viewed vs swiped away" for Shorts; the app shows public counts from the Data API instead.
- OpenRouter free model list is fetched live (`/api/v1/models`, pricing 0); deprecated models are skipped.
- Script genres have style guides + auto caption font/colour (`GENRES` in `index.html`). The CTA is a story-specific question plus a rotating short follow-up (`buildCta`).

## Conventions
- Keep it dependency-free: no `npm install`, ESM only (`"type": "module"`), Node ≥18 (global `fetch`). Browser libraries come from pinned CDN URLs.
- The JS in `index.html` is written in a dense, compact style (many statements per line). Match it when editing nearby code.

## Current focus
His Shorts get few views. Findings: hook is OK (~37% swiped away on one Short) but average watch ~16s; plan was shorter scripts (about 25-35s), end on the payoff, vary formats, and add own commentary (Reaction genre) to avoid YouTube's inauthentic-content risk. Possible next: a "Short mode" (length cap + on-screen CTA), subreddit quick-picks, a max-word filter for long posts, auto token refresh on 401, workflows for Flux/Z-Image.
