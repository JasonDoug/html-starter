#!/usr/bin/env node
// Scan a models tree, classify .safetensors files by reading their header, and (with --apply) move
// stray full checkpoints into the ComfyUI checkpoints folder. Dry-run by default. Never deletes.
//   node imagegen/scan-models.mjs [MODELS_DIR] [--apply | --link]
import fs from 'node:fs';
import path from 'node:path';
import { CHECKPOINTS_DIR, MODELS_DIR } from './comfy.mjs';
import { header, classify } from './classify.mjs';

const args = process.argv.slice(2);
const link = args.includes('--link');            // symlink instead of move (keeps the original where other tools expect it)
const apply = args.includes('--apply') || link;
const root = path.resolve(args.find(a => !a.startsWith('--')) || MODELS_DIR);
const dest = path.resolve(CHECKPOINTS_DIR);

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;                  // HF cache snapshots are symlinks into blobs/: leave them alone
    if (e.isDirectory()) { if (!/^(\.git|blobs|\.no_exist)$/.test(e.name)) walk(f, out, depth + 1); }
    else if (/\.safetensors$/i.test(e.name)) out.push(f);
  }
  return out;
}

const files = walk(root);
const inDest = f => path.resolve(f).startsWith(dest + path.sep);
const rows = files.map(f => {
  const sz0 = fs.statSync(f).size, h = sz0 < 1024 ? null : header(f), c = h ? classify(h) : { kind: sz0 < 1024 ? 'empty' : 'unreadable', fits: false, note: 'not a valid safetensors header (partial download or a renamed .pth?)' };
  return { f, size: fs.statSync(f).size, ...c, home: inDest(f) };
});
const gb = n => (n / 1e9).toFixed(2) + ' GB';
console.log(`Scanned ${root}  (${rows.length} .safetensors files)\nCheckpoints folder: ${dest}\n`);
for (const r of rows) console.log(`${r.fits ? (r.home ? 'OK     ' : 'STRAY  ') : 'other  '} ${r.kind.padEnd(16)} ${gb(r.size).padStart(9)}  ${path.relative(root, r.f)}${r.fits ? '' : '   [' + r.note + ']'}`);
const stray = rows.filter(r => r.fits && !r.home);
console.log(`\n${rows.filter(r => r.fits && r.home).length} usable checkpoint(s) already in place, ${stray.length} stray.`);
if (!stray.length) process.exit(0);
if (!apply) { console.log('Dry run. Re-run with --apply to MOVE the stray ones, or --link to symlink them (original stays put).'); process.exit(0); }
fs.mkdirSync(dest, { recursive: true });
for (const r of stray) {
  const to = path.join(dest, path.basename(r.f));
  if (fs.existsSync(to)) { console.log(`skip (name exists): ${path.basename(r.f)}`); continue; }
  try { if (link) { fs.symlinkSync(r.f, to); console.log(`linked: ${to} -> ${r.f}`); } else { fs.renameSync(r.f, to); console.log(`moved: ${r.f} -> ${to}`); } }
  catch (e) { console.log(`could not move ${r.f}: ${e.code === 'EXDEV' ? 'different filesystem; move it manually' : e.message}`); }
}
console.log('Done. Refresh ComfyUI (press r in its UI) so it re-indexes, then reopen the Visuals step.');
