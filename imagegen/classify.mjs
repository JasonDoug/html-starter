// Safetensors header reader + model classifier (shared by comfy.mjs and scan-models.mjs)
import fs from 'node:fs';

export function header(file) {
  let fd; try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const b8 = Buffer.alloc(8);
    if (fs.readSync(fd, b8, 0, 8, 0) < 8) return null;
    const n = Number(b8.readBigUInt64LE(0));
    if (!(n > 1 && n < 200e6)) return null;
    const hb = Buffer.alloc(n);
    fs.readSync(fd, hb, 0, n, 8);
    return JSON.parse(hb.toString('utf8'));
  } catch { return null; } finally { fs.closeSync(fd); }
}

// What kind of model is this? CheckpointLoaderSimple (our workflow) needs UNet + text encoder + VAE in ONE file.
// kind 'sdxl' / 'sd1' are the usable ones (fits: true); profileFor() in comfy.mjs picks settings by kind.
export function classify(h) {
  if (!h) return { kind: 'unreadable', fits: false, note: 'not a valid safetensors header (partial download or a renamed .pth?)' };
  const keys = Object.keys(h).filter(k => k !== '__metadata__');
  const has = p => keys.some(k => k.startsWith(p));
  if (keys.some(k => /lora_(up|down|A|B)|\.lora\./.test(k)) || h.__metadata__?.ss_output_name || h.__metadata__?.ss_network_module) return { kind: 'lora', fits: false, note: 'LoRA, not a checkpoint' };
  const unet = has('model.diffusion_model.'), vae = has('first_stage_model.'), clip = has('conditioner.embedders.') || has('cond_stage_model.') || has('text_encoders.');
  if (unet && vae && clip) return has('conditioner.embedders.1.') ? { kind: 'sdxl', fits: true, note: 'SDXL checkpoint' } : { kind: 'sd1', fits: true, note: 'SD 1.x/2.x checkpoint' };
  const arch = h.__metadata__?.['modelspec.architecture'];
  if (unet || has('double_blocks.') || has('joint_blocks.') || (has('layers.0.') && has('cap_embedder.'))) return { kind: 'diffusion-only', fits: false, note: `diffusion model only${arch ? ' (' + arch + ')' : ''}, needs a separate text encoder + VAE` };
  if ((has('encoder.') && has('decoder.')) || (vae && !unet)) return { kind: 'vae', fits: false, note: 'VAE' };
  if (has('text_model.') || has('encoder.block.')) return { kind: 'text-encoder', fits: false, note: 'text encoder' };
  const pre = [...new Set(keys.map(k => k.split('.').slice(0, 2).join('.')))].slice(0, 4).join(', ');
  return { kind: 'unknown', fits: false, note: 'not an image checkpoint (key prefixes: ' + pre + ')' };
}

// Classify a file, cached by path + size + mtime. Tiny files (empty placeholders) aren't opened.
const cache = new Map();
export function describeFile(file, st) {
  try { st = st || fs.statSync(file); } catch { return { kind: 'missing', fits: false, note: 'file not found' }; }
  const hit = cache.get(file);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.r;
  const r = st.size < 1024 ? { kind: 'empty', fits: false, note: 'empty file' } : classify(header(file));
  cache.set(file, { size: st.size, mtime: st.mtimeMs, r }); return r;
}
