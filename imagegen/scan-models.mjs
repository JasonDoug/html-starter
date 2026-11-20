#!/usr/bin/env node
// Scan a models tree, classify .safetensors files by reading their header, and (with --apply) move
// stray full checkpoints into the ComfyUI checkpoints folder. Dry-run by default. Never deletes.
//   node imagegen/scan-models.mjs [MODELS_DIR] [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { CHECKPOINTS_DIR, MODELS_DIR } from './comfy.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const root = path.resolve(args.find(a => !a.startsWith('--')) || MODELS_DIR);
const dest = path.resolve(CHECKPOINTS_DIR);

function header(file) {
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
  return { kind: 'unknown', fits: false, note: 'could not identify' };
}

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;                  // HF cache snapshots are symlinks into blobs/: leave them alone
    if (e.isDirectory()) { if (!/^(\.git|blobs)$/.test(e.name)) walk(f, out, depth + 1); }
    else if (/\.safetensors$/i.test(e.name)) out.push(f);
  }
  return out;
}

const files = walk(root);
const inDest = f => path.resolve(f).startsWith(dest + path.sep);
const rows = files.map(f => {
  const h = header(f), c = h ? classify(h) : { kind: 'unreadable', fits: false, note: 'not a valid safetensors header (partial download?)' };
  return { f, size: fs.statSync(f).size, ...c, home: inDest(f) };
});
const gb = n => (n / 1e9).toFixed(2) + ' GB';
console.log(`Scanned ${root}  (${rows.length} .safetensors files)\nCheckpoints folder: ${dest}\n`);
for (const r of rows) console.log(`${r.fits ? (r.home ? 'OK     ' : 'STRAY  ') : 'other  '} ${r.kind.padEnd(16)} ${gb(r.size).padStart(9)}  ${path.relative(root, r.f)}${r.fits ? '' : '   [' + r.note + ']'}`);
const stray = rows.filter(r => r.fits && !r.home);
console.log(`\n${rows.filter(r => r.fits && r.home).length} usable checkpoint(s) already in place, ${stray.length} stray.`);
if (!stray.length) process.exit(0);
if (!apply) { console.log('Dry run. Re-run with --apply to move the stray ones into the checkpoints folder.'); process.exit(0); }
fs.mkdirSync(dest, { recursive: true });
for (const r of stray) {
  const to = path.join(dest, path.basename(r.f));
  if (fs.existsSync(to)) { console.log(`skip (name exists): ${path.basename(r.f)}`); continue; }
  try { fs.renameSync(r.f, to); console.log(`moved: ${r.f} -> ${to}`); }
  catch (e) { console.log(`could not move ${r.f}: ${e.code === 'EXDEV' ? 'different filesystem; move it manually' : e.message}`); }
}
console.log('Done. Refresh ComfyUI (press r in its UI) so it re-indexes, then reopen the Visuals step.');
