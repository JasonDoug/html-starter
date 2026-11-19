#!/usr/bin/env bash
# Download image models for Reddit Video Studio into ComfyUI's checkpoints folder.
# Usage: ./download-models.sh /path/to/comfyui/models/checkpoints [--all]
# Each SDXL-Lightning checkpoint is ~6.9 GB. Resumable (re-run if interrupted).
set -u
DEST="${1:-}"
if [ -z "$DEST" ]; then echo "Usage: $0 /path/to/ComfyUI/models/checkpoints [--all]"; exit 1; fi
mkdir -p "$DEST"
get() { # url filename
  if [ -s "$DEST/$2" ]; then echo "✓ $2 already present"; return; fi
  echo "↓ $2"; curl -fL -C - --progress-bar -o "$DEST/$2.part" "$1" && mv "$DEST/$2.part" "$DEST/$2" || echo "✗ failed: $2 (check the URL / your connection)"
}
HF=https://huggingface.co
get "$HF/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step.safetensors" sdxl_lightning_4step.safetensors   # recommended default
if [ "${2:-}" = "--all" ]; then
  get "$HF/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_2step.safetensors" sdxl_lightning_2step.safetensors
  get "$HF/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_8step.safetensors" sdxl_lightning_8step.safetensors
  get "$HF/SG161222/RealVisXL_V5.0_Lightning/resolve/main/RealVisXL_V5.0_Lightning_fp16.safetensors" RealVisXL_V5.0_Lightning_fp16.safetensors
fi
echo "Done. In ComfyUI click Refresh (or restart the container) so it sees the new checkpoints."
