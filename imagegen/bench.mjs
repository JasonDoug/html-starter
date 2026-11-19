// Measure real generation time per preset on this machine.
// Usage: COMFY_URL=http://127.0.0.1:8188 node imagegen/bench.mjs [presetId ...]
import * as comfy from './comfy.mjs';
const h = await comfy.health();
if (!h.ok) { console.error(h.error); process.exit(1); }
console.log(`ComfyUI at ${h.comfy}  device: ${h.device || 'unknown'}`);
const want = process.argv.slice(2);
const presets = h.presets.filter(p => p.available && (!want.length || want.includes(p.id)));
if (!presets.length) { console.error('No preset checkpoints found in ComfyUI. Run imagegen/download-models.sh first.\nFound:', h.checkpoints.join(', ') || '(none)'); process.exit(1); }
const prompt = 'a lone lighthouse on a rocky cliff at dusk, stormy sea, dramatic cinematic lighting, vertical composition, highly detailed';
for (const p of presets) {
  const times = [];
  for (let i = 0; i < 3; i++) { // run 1 includes model load; report warm runs
    const r = await comfy.generate({ prompt, seed: 100 + i, presetId: p.id, aspect: '9:16' });
    times.push(r.seconds); process.stdout.write(`  ${p.id} run ${i + 1}: ${r.seconds.toFixed(1)}s (${r.width}x${r.height})\n`);
  }
  const warm = times.slice(1); const avg = warm.reduce((a, b) => a + b, 0) / warm.length;
  console.log(`=> ${p.id}: warm average ${avg.toFixed(1)}s ${avg < 10 ? '(faster than the 10-20s target — you could try a higher-quality preset)' : avg <= 20 ? '✓ within the 10-20s target' : '(slower than the 10-20s target — use a smaller preset)'}\n`);
}
