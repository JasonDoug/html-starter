# AI image generation (ComfyUI)

Step 4 of the app can generate one image per script beat with **your own ComfyUI**, instead of fetching stock photos.
The browser talks to `server.mjs`, which builds a ComfyUI workflow and returns the finished image.
This only works when the app is opened through `server.mjs` (home server, localhost, or your tunnel) — not on Vercel.

## Why this setup
- **ComfyUI** is already running on the x1-pro (`comfyui-gfx1151`, ROCm). It has a stable HTTP API, so nothing new to install.
- **SDXL-Lightning 4-step** (ByteDance) is the default model: good-looking SDXL images in 4 steps, permissive OpenRAIL++ license (fine for monetized videos).
  Measured on the Radeon 890M at 576x1024: **about 4.5 s per image** once the model is loaded.
- Heavier models (FLUX, full SDXL with 30 steps) take minutes per image on an iGPU, so they are not offered.

## Setup
1. Download the checkpoint(s) into the folder your ComfyUI container mounts as `models/checkpoints`:
   ```bash
   ./imagegen/download-models.sh /path/to/ComfyUI/models/checkpoints          # 4-step only (~7 GB)
   ./imagegen/download-models.sh /path/to/ComfyUI/models/checkpoints --all    # + 2-step, 8-step, RealVisXL
   ```
2. Restart the ComfyUI container (or press Refresh in ComfyUI) so it sees the files.
3. Start the app server pointing at ComfyUI (default is `http://127.0.0.1:8188`):
   ```bash
   COMFY_URL=http://127.0.0.1:8188 node server.mjs
   ```
   With Docker Compose the app container reaches the host via `host.docker.internal`; set `COMFY_URL` in `.env` if your ComfyUI port differs.
4. In the app: step 4 → Image source → **AI generated**. The status box shows whether ComfyUI is connected. Pick a model; its generation settings are chosen automatically and shown under the dropdown.

## Measure your speed
```bash
COMFY_URL=http://127.0.0.1:8188 node imagegen/bench.mjs              # every usable model
COMFY_URL=http://127.0.0.1:8188 node imagegen/bench.mjs realvis lightning   # names containing these words
```
The first run loads the model (and on ROCm may compile kernels), so only the warm runs count. Warm times are saved to `imagegen/timings.json`
(also updated by normal use in the app) and shown in the model dropdown, which lists the fastest models first.

## Automatic settings per model
`imagegen/presets.json` holds settings profiles. The first profile whose `match` regex matches the checkpoint filename wins (SDXL-Lightning 2/4/8-step,
RealVisXL Lightning, LCM / Lightning / Hyper / Turbo merges, Pony with score tags and clip skip 2, Juggernaut XL). Any other model gets the
`fallback` for its type: 25 steps and cfg 6-7 for standard SDXL / SD 1.5. To tune a model, add a profile above the generic ones.

## Troubleshooting
- **Black or green images** on ROCm: start ComfyUI with `--fp32-vae` (or `--bf16-vae`).
- **Model dropdown**: lists every full SDXL / SD 1.5 checkpoint found anywhere under `MODELS_DIR` (default `/home/jason/models`). Ones outside the checkpoints folder are symlinked in on first use. `node imagegen/scan-models.mjs --apply` moves them in permanently (a symlink stays at the old path). Diffusion-only models (FLUX, Z-Image), LoRAs and VAEs are shown disabled: the workflow loads everything from one checkpoint file.
- **First image very slow**: normal (model load + kernel compile). Later ones are faster.
- **Out of memory**: pick a smaller/faster model (e.g. SDXL-Lightning 2-step), or close other GPU services (llama.cpp, vLLM) while generating.

## How prompts are made
The script generator now also writes an `image_prompts` list (one vivid prompt per beat). Older scripts fall back to a prompt built from the beat text.
You can edit every prompt in step 4 and regenerate a single beat with its refresh button. The chosen **Style** is appended to each prompt, and a default
"no text/watermark/blurry" negative prompt is always applied (plus anything you add under "Extra things to avoid").
