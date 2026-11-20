#!/usr/bin/env bash
# Point Hugging Face downloads (hf download / huggingface-cli / diffusers) at your ComfyUI checkpoints folder
# so a plain `hf download org/model file` lands where ComfyUI can see it, without --local-dir.
# Usage: imagegen/setup-hf-cache.sh [DIR]     (default: /home/jason/models/Checkpoints/checkpoints)
set -euo pipefail
DIR="${1:-/home/jason/models/Checkpoints/checkpoints}"
mkdir -p "$DIR"
BEGIN="# >>> rvs hf cache >>>"; END="# <<< rvs hf cache <<<"
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -f "$rc" ] || continue
  sed -i "/$BEGIN/,/$END/d" "$rc"        # idempotent: replace any previous block
  printf '%s\nexport HF_HUB_CACHE="%s"\nexport HUGGINGFACE_HUB_CACHE="%s"\n%s\n' "$BEGIN" "$DIR" "$DIR" "$END" >> "$rc"
  echo "updated $rc"
done
if [ -d "$HOME/.config/fish" ]; then
  mkdir -p "$HOME/.config/fish/conf.d"
  printf 'set -gx HF_HUB_CACHE "%s"\nset -gx HUGGINGFACE_HUB_CACHE "%s"\n' "$DIR" "$DIR" > "$HOME/.config/fish/conf.d/rvs-hf.fish"; echo "updated fish conf.d"
fi
echo "HF_HUB_CACHE -> $DIR"
echo "Open a new terminal (or: source ~/.bashrc), then check: hf env | grep -i cache"
