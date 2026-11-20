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
// ---- Model discovery: find every .safetensors under MODELS_DIR and work out whether our workflow can load it (classify.mjs) ----
// Walks MODELS_DIR following symlinks (so Hugging Face cache snapshots are seen), skipping HF blob stores,
// and returns one entry per real file. Files already inside CHECKPOINTS_DIR win, named as ComfyUI names them.
export function discoverModels(root = MODELS_DIR) {
  const ck = path.resolve(CHECKPOINTS_DIR), seen = new Set(), byReal = new Map();
  const walk = (dir, depth) => {
    if (depth > 10) return;
    let real; try { real = fs.realpathSync(dir); } catch { return; }
    if (seen.has(real)) return; seen.add(real);
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (/^(\.git|blobs|\.no_exist|\.locks|node_modules)$/.test(e.name)) continue;
      const f = path.join(dir, e.name);
      let st; try { st = fs.statSync(f); } catch { continue; } // broken symlink
      if (st.isDirectory()) { walk(f, depth + 1); continue; }
      if (!/\.(safetensors|sft)$/i.test(e.name) || st.size < 100e6) continue;
      let rp; try { rp = fs.realpathSync(f); } catch { continue; }
      const inCk = f.startsWith(ck + path.sep);
      const prev = byReal.get(rp);
      if (prev && (prev.inCk || !inCk)) continue;
      byReal.set(rp, { name: inCk ? path.relative(ck, f) : path.basename(f), path: f, real: rp, size: st.size, inCk, ...describeFile(rp, st) });
    }
  };
  walk(ck, 0); walk(path.resolve(root), 0);
  return [...byReal.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// Make a usable checkpoint that lives elsewhere under MODELS_DIR visible to ComfyUI by symlinking it into
// CHECKPOINTS_DIR (ComfyUI re-reads the folder when its mtime changes). Returns the name ComfyUI will use.
export function linkIntoCheckpoints(m) {
  if (m.inCk) return m.name;
  const ck = path.resolve(CHECKPOINTS_DIR);
  for (const name of [path.basename(m.real), path.join('linked', path.basename(m.real))]) {
    const to = path.join(ck, name);
    let cur = null; try { cur = fs.realpathSync(to); } catch {}
    if (cur === m.real) return name;
    if (cur || fs.existsSync(to)) continue; // name taken by a different file
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.symlinkSync(m.real, to);
    return name;
  }
  throw new Error('Could not link ' + m.real + ' into ' + ck);
}
export const NEGATIVE_DEFAULT = 'text, letters, words, watermark, logo, signature, caption, subtitles, blurry, low quality, deformed, extra fingers, bad anatomy, cropped, frame, border';

export function loadPresets() {
  return JSON.parse(fs.readFileSync(path.join(here, 'presets.json'), 'utf8'));
}

// Settings for a checkpoint: first profile whose `match` regex hits the filename, else the fallback for its type.
export function profileFor(name, kind, cfg = loadPresets()) {
  const base = path.basename(name || '');
  const p = cfg.profiles.find(x => { try { return new RegExp(x.match, 'i').test(base); } catch { return false; } });
  const fb = cfg.fallback[kind === 'sd1' ? 'sd1' : 'sdxl'];
  return { clipSkip: 0, prefix: '', negPrefix: '', ...(p || fb), auto: p ? 'model' : 'type' };
}

// Measured seconds per checkpoint (from real generations and bench.mjs), kept across restarts.
const TIMINGS = path.join(here, 'timings.json');
let timings = {}; try { timings = JSON.parse(fs.readFileSync(TIMINGS, 'utf8')); } catch {}
let lastCkpt = null; // the run right after switching model includes loading it, so it isn't counted
function recordTiming(key, secs, warm) {
  if (!warm) return;
  const t = timings[key] || { n: 0, avg: 0 }, k = Math.min(t.n, 9); // running average over ~10 runs
  timings[key] = { n: t.n + 1, avg: (t.avg * k + secs) / (k + 1) };
  try { fs.writeFileSync(TIMINGS, JSON.stringify(timings, null, 1)); } catch {}
}
// Rough guess until measured: ~1.05 s per SDXL step at 576x1024 on the reference machine, scaled by pixels.
export function estimateSeconds(prof, kind, aspect = '9:16') {
  const { width, height } = dimensions(prof, aspect);
  const evals = /^(dpmpp_sde|dpmpp_2s_ancestral|heun|dpm_2)/.test(prof.sampler) && !/2m_sde/.test(prof.sampler) ? 2 : 1; // these samplers run the model twice per step
  return 0.3 + prof.steps * evals * 1.05 * Math.pow(width * height / 589824, 1.1) * (kind === 'sd1' ? 0.45 : 1);
}

const round8 = n => Math.max(256, Math.round(n / 8) * 8);
export function dimensions(preset, aspect) {
  const L = preset.long;
  if (aspect === '16:9') return { width: round8(L), height: round8(L * 9 / 16) };
  if (aspect === '1:1') return { width: round8(L * 0.75), height: round8(L * 0.75) };
  return { width: round8(L * 9 / 16), height: round8(L) }; // 9:16 default
}

// ComfyUI API-format workflow: checkpoint [-> CLIPSetLastLayer] -> 2x CLIPTextEncode -> KSampler -> VAEDecode -> SaveImage
export function buildWorkflow({ preset, prompt, negative, seed, width, height }) {
  const clip = preset.clipSkip > 1 ? ['10', 0] : ['4', 1];
  const wf = {
    '3': { class_type: 'KSampler', inputs: { seed, steps: preset.steps, cfg: preset.cfg, sampler_name: preset.sampler, scheduler: preset.scheduler, denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: preset.ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'rvs', images: ['8', 0] } }
  };
  if (preset.clipSkip > 1) wf['10'] = { class_type: 'CLIPSetLastLayer', inputs: { stop_at_clip_layer: -preset.clipSkip, clip: ['4', 1] } };
  return wf;
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
  const models = discoverModels().map(({ name, kind, fits, note, inCk, size, path: p }) => {
    const m = { name, kind, usable: fits, note, inCk, size, path: p };
    if (fits) { const prof = profileFor(name, kind, cfg); const t = timings[path.basename(name)]; m.settings = { ...prof, est: estimateSeconds(prof, kind), measured: t && t.n ? t.avg : null }; }
    return m;
  });
  const out = { ok: false, comfy: COMFY_URL, checkpoints: [], default: cfg.default, checkpointsDir: CHECKPOINTS_DIR, modelsDir: MODELS_DIR, dirExists: fs.existsSync(CHECKPOINTS_DIR), models };
  try {
    const s = await j(COMFY_URL + '/system_stats', {}, 4000);
    if (!s.ok) throw new Error('HTTP ' + s.status);
    out.ok = true;
    out.device = s.body?.devices?.[0]?.name || '';
    const o = await j(COMFY_URL + '/object_info/CheckpointLoaderSimple', {}, 6000);
    out.checkpoints = o.body?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
  } catch (e) { out.error = `Cannot reach ComfyUI at ${COMFY_URL} (${e.message})`; }
  return out;
}

let queue = Promise.resolve(); // one GPU job at a time
export function generate(opts) {
  const run = queue.then(() => generateNow(opts));
  queue = run.catch(() => {});
  return run;
}

async function generateNow({ prompt, negative, negativeExtra, seed, aspect, ckpt }) {
  const cfg = loadPresets();
  const name = typeof ckpt === 'string' && ckpt && ckpt.length < 300 && !ckpt.includes('..') ? ckpt : cfg.default;
  const m = discoverModels().find(x => x.name === name);
  if (m && !m.fits) throw Object.assign(new Error(`${name} can't be used here: ${m.note}`), { status: 400 });
  // settings follow the model; models found elsewhere under MODELS_DIR get symlinked into the checkpoints folder on first use
  const preset = { ...profileFor(name, m?.kind, cfg), ckpt: m ? linkIntoCheckpoints(m) : name };
  const { width, height } = dimensions(preset, aspect);
  const neg = negative || (NEGATIVE_DEFAULT + (negativeExtra ? ', ' + negativeExtra : ''));
  const wf = buildWorkflow({
    preset, prompt: (preset.prefix + String(prompt)).slice(0, 1200), negative: (preset.negPrefix + String(neg)).slice(0, 700),
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
      const seconds = (Date.now() - t0) / 1000; recordTiming(path.basename(preset.ckpt), seconds, lastCkpt === preset.ckpt); lastCkpt = preset.ckpt;
      return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/png', seconds, width, height, ckpt: preset.ckpt, settings: preset };
    }
  }
  throw Object.assign(new Error('Image generation timed out after 5 minutes'), { status: 504 });
}
