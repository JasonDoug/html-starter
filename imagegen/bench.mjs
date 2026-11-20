// Measure real generation time per model (with its automatic settings) on this machine.
// Results are saved to imagegen/timings.json and shown in the app's model dropdown.
// Usage: COMFY_URL=http://127.0.0.1:8188 node imagegen/bench.mjs [name-substring ...]
import * as comfy from './comfy.mjs';
const h = await comfy.health();
if (!h.ok) { console.error(h.error); process.exit(1); }
console.log(`ComfyUI at ${h.comfy}  device: ${h.device || 'unknown'}`);
const want = process.argv.slice(2).map(s => s.toLowerCase());
const models = h.models.filter(m => m.usable && (!want.length || want.some(w => m.name.toLowerCase().includes(w))));
if (!models.length) { console.error('No usable checkpoints matched. Found:', h.models.filter(m => m.usable).map(m => m.name).join(', ') || '(none)'); process.exit(1); }
const prompt = 'a lone lighthouse on a rocky cliff at dusk, stormy sea, dramatic cinematic lighting, vertical composition, highly detailed';
for (const m of models) {
  const s = m.settings, times = [];
  console.log(`${m.name}  [${s.label}: ${s.steps} steps, cfg ${s.cfg}, ${s.sampler}/${s.scheduler}${s.clipSkip > 1 ? ', clip skip ' + s.clipSkip : ''}]  est. ${s.est.toFixed(1)}s`);
  for (let i = 0; i < 3; i++) { // run 1 includes model load; report warm runs
    const r = await comfy.generate({ prompt, seed: 100 + i, ckpt: m.name, aspect: '9:16' });
    times.push(r.seconds); console.log(`  run ${i + 1}: ${r.seconds.toFixed(1)}s (${r.width}x${r.height})${i ? '' : '  (includes loading the model)'}`);
  }
  const warm = times.slice(1), avg = warm.reduce((a, b) => a + b, 0) / warm.length;
  console.log(`=> warm average ${avg.toFixed(1)}s\n`);
}
