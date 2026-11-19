# AI image generation (ComfyUI)

Step 4 of the app can generate one image per script beat with **your own ComfyUI**, instead of fetching stock photos.
The browser talks to `server.mjs`, which builds a ComfyUI workflow and returns the finished image.
This only works when the app is opened through `server.mjs` (home server, localhost, or your tunnel) — not on Vercel.

## Why this setup
- **ComfyUI** is already running on the x1-pro (`comfyui-gfx1151`, ROCm). It has a stable HTTP API, so nothing new to install.
- **SDXL-Lightning 4-step** (ByteDance) is the default model: good-looking SDXL images in 4 steps, permissive OpenRAIL++ license (fine for monetized videos).
  Rough estimate for the Radeon 890M at 576x1024: **10-20 s per image**. This is an estimate, not a measurement; run the benchmark below.
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
4. In the app: step 4 → Image source → **AI generated**. The status box shows whether ComfyUI is connected and which presets are installed.

## Measure your speed
```bash
COMFY_URL=http://127.0.0.1:8188 node imagegen/bench.mjs            # all installed presets
COMFY_URL=http://127.0.0.1:8188 node imagegen/bench.mjs lightning-fast
```
The first run loads the model (and on ROCm may compile kernels), so only the warm runs count. If the average is over 20 s, pick the **Draft** preset;
if it is well under 10 s, try **Quality**. Presets live in `imagegen/presets.json` (edit labels, sizes, steps freely).

## Troubleshooting
- **Black or green images** on ROCm: start ComfyUI with `--fp32-vae` (or `--bf16-vae`).
- **"checkpoint not installed"** next to a preset: the file name must match `presets.json` exactly.
- **First image very slow**: normal (model load + kernel compile). Later ones are faster.
- **Out of memory**: use the Draft preset, or close other GPU services (llama.cpp, vLLM) while generating.

## How prompts are made
The script generator now also writes an `image_prompts` list (one vivid prompt per beat). Older scripts fall back to a prompt built from the beat text.
You can edit every prompt in step 4 and regenerate a single beat with its refresh button. The chosen **Style** is appended to each prompt, and a default
"no text/watermark/blurry" negative prompt is always applied (plus anything you add under "Extra things to avoid").
