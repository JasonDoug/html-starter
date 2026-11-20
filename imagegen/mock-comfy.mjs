// Tiny fake ComfyUI for tests: validates the workflow shape and returns a PNG. Usage: node mock-comfy.mjs <port> <png> <logfile>
import http from 'node:http'; import fs from 'node:fs';
const [port, png, log] = [process.argv[2] || 8199, process.argv[3], process.argv[4] || '/tmp/mock-comfy.log'];
const jobs = {}; let n = 0;
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const send = (o, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/system_stats') return send({ devices: [{ name: 'mock gpu' }] });
  if (u.pathname === '/object_info/CheckpointLoaderSimple') return send({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl_lightning_4step.safetensors', 'sdxl_lightning_2step.safetensors']] } } } });
  if (u.pathname === '/prompt' && req.method === 'POST') {
    let raw = ''; for await (const c of req) raw += c; const wf = JSON.parse(raw).prompt;
    fs.appendFileSync(log, JSON.stringify(wf) + '\n');
    if (!['KSampler', 'CheckpointLoaderSimple', 'EmptyLatentImage', 'CLIPTextEncode', 'VAEDecode', 'SaveImage'].every(t => Object.values(wf).some(x => x.class_type === t))) return send({ error: { message: 'bad workflow' } }, 400);
    const ck = Object.values(wf).find(x => x.class_type === 'CheckpointLoaderSimple').inputs.ckpt_name;
    if (!['sdxl_lightning_4step.safetensors', 'sdxl_lightning_2step.safetensors'].includes(ck)) return send({ error: { message: 'bad' }, node_errors: { 4: { errors: [{ message: `Value not in list: ckpt_name: '${ck}'` }] } } }, 400);
    const id = 'job' + (++n); jobs[id] = Date.now(); return send({ prompt_id: id });
  }
  if (u.pathname.startsWith('/history/')) { const id = u.pathname.split('/')[2]; if (!jobs[id] || Date.now() - jobs[id] < 700) return send({}); return send({ [id]: { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'rvs_0001.png', subfolder: '', type: 'output' }] } } } }); }
  if (u.pathname === '/view') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(fs.readFileSync(png)); }
  send({}, 404);
}).listen(port);
