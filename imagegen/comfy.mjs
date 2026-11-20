// ComfyUI adapter for Reddit Video Studio. No dependencies.
// ComfyUI HTTP API: POST /prompt -> poll GET /history/{id} -> GET /view
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describeFile } from './classify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const COMFY_URL = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/+$/, '');
// Where ComfyUI looks for checkpoints (see ComfyUI's extra_model_paths.yaml: base_path + checkpoints entry)
export const MODELS_DIR = process.env.MODELS_DIR || '/home/jason/models';
export const CHECKPOINTS_DIR = process.env.CHECKPOINTS_DIR || path.join(MODELS_DIR, 'Checkpoints', 'checkpoints');
function scanModels(dir, depth = 0, base = dir, out = []) {
  if (depth > 4) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    let isDir = e.isDirectory(); if (e.isSymbolicLink()) { try { isDir = fs.statSync(f).isDirectory(); } catch { continue; } }
    if (isDir) scanModels(f, depth + 1, base, out);
    else if (/\.(safetensors|ckpt|pt|pth)$/i.test(e.name)) out.push(path.relative(base, f));
  }
  return out;
}
export const NEGATIVE_DEFAULT = 'text, letters, words, watermark, logo, signature, caption, subtitles, blurry, low quality, deformed, extra fingers, bad anatomy, cropped, frame, border';

export function loadPresets() {
  return JSON.parse(fs.readFileSync(path.join(here, 'presets.json'), 'utf8'));
}

const round8 = n => Math.max(256, Math.round(n / 8) * 8);
export function dimensions(preset, aspect) {
  const L = preset.long;
  if (aspect === '16:9') return { width: round8(L), height: round8(L * 9 / 16) };
  if (aspect === '1:1') return { width: round8(L * 0.75), height: round8(L * 0.75) };
  return { width: round8(L * 9 / 16), height: round8(L) }; // 9:16 default
}

// ComfyUI API-format workflow: checkpoint -> 2x CLIPTextEncode -> KSampler -> VAEDecode -> SaveImage
export function buildWorkflow({ preset, prompt, negative, seed, width, height }) {
  return {
    '3': { class_type: 'KSampler', inputs: { seed, steps: preset.steps, cfg: preset.cfg, sampler_name: preset.sampler, scheduler: preset.scheduler, denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: preset.ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'rvs', images: ['8', 0] } }
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function j(url, opts = {}, ms = 10000) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { ok: r.ok, status: r.status, body };
}

export async function health() {
  const cfg = loadPresets();
  const out = { ok: false, comfy: COMFY_URL, checkpoints: [], presets: [], default: cfg.default, checkpointsDir: CHECKPOINTS_DIR, dirExists: fs.existsSync(CHECKPOINTS_DIR), diskModels: scanModels(CHECKPOINTS_DIR).sort(), modelInfo: {} };
  for (const n of out.diskModels) { const d = describeFile(path.join(CHECKPOINTS_DIR, n)); out.modelInfo[n] = { kind: d.kind, fits: d.fits }; }
  try {
    const s = await j(COMFY_URL + '/system_stats', {}, 4000);
    if (!s.ok) throw new Error('HTTP ' + s.status);
    out.ok = true;
    out.device = s.body?.devices?.[0]?.name || '';
    const o = await j(COMFY_URL + '/object_info/CheckpointLoaderSimple', {}, 6000);
    out.checkpoints = o.body?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
  } catch (e) { out.error = `Cannot reach ComfyUI at ${COMFY_URL} (${e.message})`; }
  out.presets = cfg.presets.map(p => ({ id: p.id, label: p.label, ckpt: p.ckpt, available: out.checkpoints.includes(p.ckpt) }));
  return out;
}

let queue = Promise.resolve(); // one GPU job at a time
export function generate(opts) {
  const run = queue.then(() => generateNow(opts));
  queue = run.catch(() => {});
  return run;
}

async function generateNow({ prompt, negative, negativeExtra, seed, presetId, aspect, ckpt }) {
  const cfg = loadPresets();
  let preset = cfg.presets.find(p => p.id === (presetId || cfg.default));
  if (!preset) throw Object.assign(new Error('Unknown preset ' + presetId), { status: 400 });
  if (ckpt && typeof ckpt === 'string' && ckpt.length < 300 && !ckpt.includes('..')) preset = { ...preset, ckpt }; // user-chosen model, keeps the preset's steps/sampler/size
  const { width, height } = dimensions(preset, aspect);
  const wf = buildWorkflow({
    preset, prompt: String(prompt).slice(0, 1200), negative: String(negative || (NEGATIVE_DEFAULT + (negativeExtra ? ', ' + negativeExtra : ''))).slice(0, 700),
    seed: Number.isFinite(+seed) ? Math.abs(Math.floor(+seed)) % 2 ** 32 : crypto.randomInt(2 ** 31), width, height
  });
  const t0 = Date.now();
  const sub = await j(COMFY_URL + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: crypto.randomUUID() }) });
  if (!sub.ok) {
    const ne = sub.body?.node_errors && Object.values(sub.body.node_errors)[0]?.errors?.[0]?.message;
    const msg = ne || sub.body?.error?.message || (typeof sub.body === 'string' ? sub.body.slice(0, 200) : 'ComfyUI rejected the job');
    throw Object.assign(new Error(`${msg}${/ckpt|checkpoint|not in/i.test(msg) ? ` — is "${preset.ckpt}" in ComfyUI's checkpoints folder?` : ''}`), { status: 502 });
  }
  const id = sub.body.prompt_id;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    await sleep(500);
    const h = await j(`${COMFY_URL}/history/${id}`, {}, 8000);
    const e = h.body && h.body[id];
    if (!e) continue;
    if (e.status?.status_str === 'error') throw Object.assign(new Error('ComfyUI failed: ' + JSON.stringify(e.status.messages?.slice(-1)[0] || '').slice(0, 300)), { status: 502 });
    const img = e.outputs?.['9']?.images?.[0];
    if (img) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
      const r = await fetch(`${COMFY_URL}/view?${q}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Object.assign(new Error('Could not fetch result image'), { status: 502 });
      return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/png', seconds: (Date.now() - t0) / 1000, width, height, preset: preset.id };
    }
  }
  throw Object.assign(new Error('Image generation timed out after 5 minutes'), { status: 504 });
}
