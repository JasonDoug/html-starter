#!/usr/bin/env node
// Scan a models tree (following symlinks, so Hugging Face cache snapshots count), classify every .safetensors
// by reading its header, and with --apply bring every usable full checkpoint into the ComfyUI checkpoints folder:
//  - a plain file elsewhere is MOVED in, and a symlink is left at its old path so other apps keep working
//  - a checkpoints-folder symlink pointing elsewhere is replaced by the real file (old path becomes the symlink)
//  - a file inside a Hugging Face cache is symlinked in (moving it would break the cache)
// With --link instead, every stray checkpoint is only symlinked in (originals stay where other tools expect them).
// Dry-run by default. Never deletes model data.
//   node imagegen/scan-models.mjs [MODELS_DIR] [--apply | --link]
import fs from 'node:fs';
import path from 'node:path';
import { CHECKPOINTS_DIR, MODELS_DIR, discoverModels, linkIntoCheckpoints } from './comfy.mjs';

const args = process.argv.slice(2);
const link = args.includes('--link');
const apply = args.includes('--apply') || link;
const root = path.resolve(args.find(a => !a.startsWith('--')) || MODELS_DIR);
const dest = path.resolve(CHECKPOINTS_DIR);
const inside = (f, d) => path.resolve(f).startsWith(d + path.sep);
const hfCache = m => /[\\/](blobs|snapshots)[\\/]/.test(m.real) || /[\\/]snapshots[\\/]/.test(m.path);

const rows = discoverModels(root);
const gb = n => (n / 1e9).toFixed(2) + ' GB';
const status = m => !m.fits ? 'other  ' : !m.inCk ? 'STRAY  ' : inside(m.real, fs.realpathSync(dest)) ? 'OK     ' : 'LINKED ';
console.log(`Scanned ${root}  (${rows.length} model files >100 MB)\nCheckpoints folder: ${dest}\n`);
for (const m of rows) console.log(`${status(m)} ${m.kind.padEnd(15)} ${gb(m.size).padStart(9)}  ${path.relative(root, m.path)}${m.real !== path.resolve(m.path) ? '  -> ' + m.real : ''}${m.fits ? '' : '   [' + m.note + ']'}`);
const todo = rows.filter(m => m.fits && (link ? status(m) === 'STRAY  ' : status(m) !== 'OK     '));
console.log(`\n${rows.filter(m => status(m) === 'OK     ').length} usable checkpoint(s) stored in the checkpoints folder, ${todo.length} to bring in (STRAY = not visible to ComfyUI, LINKED = visible via symlink).`);
if (!todo.length) process.exit(0);
if (!apply) { console.log('Dry run. Re-run with --apply to MOVE them into the checkpoints folder, or --link to only symlink the stray ones (originals stay put).'); process.exit(0); }

fs.mkdirSync(dest, { recursive: true });
for (const m of todo) {
  try {
    if (link || hfCache(m)) { const n = linkIntoCheckpoints(m); console.log(`linked${link ? '' : ' (HF cache, not moved)'}: ${n} -> ${m.real}`); continue; }
    let to = path.join(dest, path.basename(m.real));
    if (m.inCk) { // checkpoints/<name> is a symlink to the real file: put the real file there instead
      to = path.join(dest, m.name);
      if (!fs.lstatSync(to).isSymbolicLink()) { console.log(`skip (unexpected, not a symlink): ${to}`); continue; }
      fs.unlinkSync(to);
    } else if (fs.existsSync(to) || isLink(to)) { console.log(`skip (name already used in checkpoints folder): ${path.basename(to)}`); continue; }
    try { fs.renameSync(m.real, to); }
    catch (e) { if (m.inCk) fs.symlinkSync(m.real, to); throw e; } // restore the link we removed
    fs.symlinkSync(to, m.real); // leave a pointer at the old location
    console.log(`moved: ${m.real} -> ${to}  (symlink left at old path)`);
  } catch (e) { console.log(`could not move ${m.real}: ${e.code === 'EXDEV' ? 'different filesystem; move it manually' : e.message}`); }
}
function isLink(f) { try { return fs.lstatSync(f).isSymbolicLink(); } catch { return false; } }
console.log('Done. ComfyUI picks up folder changes on its next model list; reopen the Visuals step.');
