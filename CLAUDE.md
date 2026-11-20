# Reddit Video Studio (html-starter)

Browser app that turns a Reddit / Hacker News / Guardian post into a short video: scrape -> script -> voiceover -> visuals -> assemble -> YouTube upload -> analytics.
Owner: Jason (Las Vegas). He runs it **locally** via `node server.mjs` (the Vercel deploy is abandoned; `api/` is a leftover that can be removed).

## Working rules
- **Push straight to `main`** unless he explicitly asks for a PR.
- Free services only; keep things browser-native where possible.
- Single-page vanilla JS: almost everything is inline in `index.html`. Check JS syntax after edits (extract the biggest `<script>` and run `node --check`).
- Commit trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never commit secrets (API keys, tokens). Reminders still open: he should revoke a GitHub PAT pasted in an earlier session and rotate the exposed rss2json key.

## Run
`node server.mjs` (serves `index.html`, `/api/rss`, `/api/arctic`, `/api/sources`, `/api/imagegen/*`). Image gen needs ComfyUI at `COMFY_URL` (default `http://127.0.0.1:8188`).

## Machines / paths
- x1-pro (daily driver, ComfyUI at `/home/jason/AI-ImageGen/ComfyUI`), models root `/home/jason/models` (ComfyUI `extra_model_paths.yaml`: `checkpoints: Checkpoints/checkpoints`).
- Checkpoints folder: `/home/jason/models/Checkpoints/checkpoints` (override with `CHECKPOINTS_DIR` / `MODELS_DIR`).
- HF cache script: `imagegen/setup-hf-cache.sh`. Model scanner: `node imagegen/scan-models.mjs [--apply|--link]` (dry run by default; never deletes).

## Key facts learned (don't re-discover)
- Reddit ended RSS (Nov 13 2026) and unauthenticated JSON. Posts come from the **Arctic Shift archive** (`arctic-shift.photon-reddit.com/api/posts/search`), newest-first, 100 per call, no score sort. "Top" slices the time window into several calls and ranks by score client-side. Time-of-day `after`/`before` bounds are unverified live (falls back to date-only). PRAW no longer works for him.
- Voiceover: Kokoro TTS in the browser (Web Speech cannot be recorded). Word timings are estimated per sentence.
- Assembly: canvas + AudioContext -> MediaRecorder (MP4 if supported else WebM), FFmpeg.wasm only to convert when needed.
- Caption fonts must be web fonts (Google Fonts link in `<head>`); system fonts like Impact don't exist on his Linux box.
- Wikimedia Commons only serves standard thumbnail widths (other widths -> HTTP 429).
- Google sign-in: GIS `initTokenClient`; needs an exact https origin (Cloudflare tunnel) registered, Web application client type. Tokens last ~1h, no auto-refresh yet.
- YouTube Analytics API lags Studio by 1-3 days and has no "viewed vs swiped away" for Shorts; the app shows public counts from the Data API instead.
- OpenRouter free model list is fetched live (`/api/v1/models`, pricing 0); deprecated models are skipped.
- ComfyUI workflow uses `CheckpointLoaderSimple`, so only all-in-one SD1.5/SDXL checkpoints work. Flux-2-klein and Z-Image-Turbo files need a different workflow (not built).
- Script genres have style guides + auto caption font/colour (`GENRES` in `index.html`). The CTA is a story-specific question plus a rotating short follow-up (`buildCta`).

## Current focus
His Shorts get few views. Findings: hook is OK (~37% swiped away on one Short) but average watch ~16s; plan was shorter scripts (about 25-35s), end on the payoff, vary formats, and add own commentary (Reaction genre) to avoid YouTube's inauthentic-content risk. Possible next: a "Short mode" (length cap + on-screen CTA), subreddit quick-picks, a max-word filter for long posts, auto token refresh on 401, workflows for Flux/Z-Image.
