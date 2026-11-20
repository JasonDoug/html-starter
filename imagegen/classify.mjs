// Safetensors header reader + model classifier (shared by comfy.mjs and scan-models.mjs)
import fs from 'node:fs';

export function header(file) {
  const fd = fs.openSync(file, 'r');
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
export function classify(h) {
  const keys = Object.keys(h).filter(k => k !== '__metadata__');
  const has = p => keys.some(k => k.startsWith(p));
  if (keys.some(k => /lora_(up|down|A|B)|\.lora\./.test(k))) return { kind: 'lora', fits: false, note: 'LoRA -> models/loras' };
  const unet = has('model.diffusion_model.'), vae = has('first_stage_model.'), clip = has('conditioner.embedders.') || has('cond_stage_model.') || has('text_encoders.');
  if (unet && vae && clip) {
    const sdxl = has('conditioner.embedders.1.');
    return { kind: sdxl ? 'checkpoint-sdxl' : 'checkpoint-sd1/2', fits: true, note: 'full checkpoint' };
  }
  if (unet) return { kind: 'diffusion-only', fits: false, note: 'UNet/diffusion model only (needs separate text encoder + VAE) -> models/diffusion_models or unet' };
  if ((has('encoder.') && has('decoder.')) || (vae && !unet)) return { kind: 'vae', fits: false, note: 'VAE -> models/vae' };
  if (has('text_model.') || has('encoder.block.')) return { kind: 'text-encoder', fits: false, note: 'text encoder -> models/text_encoders / clip' };
  const pre = [...new Set(keys.map(k => k.split('.').slice(0, 2).join('.')))].slice(0, 4).join(', ');
  return { kind: 'unknown', fits: false, note: 'not a standard all-in-one checkpoint (key prefixes: ' + pre + ')' };
}

const cache = new Map();
export function describeFile(file) {
  let st; try { st = fs.statSync(file); } catch { return { kind: 'missing', fits: false }; }
  const key = file + '|' + st.size + '|' + st.mtimeMs, hit = cache.get(key);
  if (hit) return hit;
  const h = st.size < 1024 ? null : header(file);
  const r = h ? classify(h) : { kind: st.size < 1024 ? 'empty' : 'unreadable', fits: false, note: 'not a readable safetensors file' };
  cache.set(key, r); return r;
}
