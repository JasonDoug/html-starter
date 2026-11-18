// Local server: node server.mjs  ->  http://localhost:3000
// Serves index.html, reuses api/sources.js, and proxies Reddit RSS from YOUR IP
// (home IPs are rarely rate limited, unlike shared proxies).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const sources = (await import(pathToFileURL(path.join(dir, 'api/sources.js')))).default;

function shim(res) {
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  return res;
}

const rssCache=new Map();
let blockedUntil=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (u.pathname === '/api/sources') {
      req.query = Object.fromEntries(u.searchParams);
      return await sources(req, shim(res));
    }
    if (u.pathname === '/api/rss') {
      const target = new URL(u.searchParams.get('url') || '');
      if (!/(^|\.)reddit\.com$/.test(target.hostname)) { res.statusCode = 400; return res.end('reddit.com only'); }
      const key = target.href, c = rssCache.get(key);
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('X-RVS-Local', '1');
      res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-RVS-Local');
      if (c && Date.now() - c.t < 5 * 60 * 1000) { res.statusCode = 200; return res.end(c.body); }
      if (Date.now() < blockedUntil) { // Reddit asked us to back off: don't hammer it
        res.statusCode = 429; res.setHeader('Retry-After', String(Math.ceil((blockedUntil - Date.now()) / 1000)));
        return res.end('rate limited');
      }
      const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) RedditVideoStudio/1.0', Accept: 'application/atom+xml,application/xml,text/xml' }, signal: AbortSignal.timeout(15000) });
      const body = await r.text();
      if (r.ok) { rssCache.set(key, { t: Date.now(), body }); res.statusCode = 200; return res.end(body); }
      if (c) { res.statusCode = 200; return res.end(c.body); } // serve stale on failure
      if (r.status === 429) {
        const secs = Math.min(120, Math.max(5, parseInt(r.headers.get('retry-after')) || parseInt(r.headers.get('x-ratelimit-reset')) || 60));
        blockedUntil = Date.now() + secs * 1000;
        res.setHeader('Retry-After', String(secs));
      }
      res.statusCode = r.status;
      return res.end(body.slice(0, 300));
    }
    const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    if (file.includes('..') || file.startsWith('api') || file === 'server.mjs') { res.statusCode = 404; return res.end('Not found'); }
    const data = fs.readFileSync(path.join(dir, file));
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(data);
  } catch (e) { res.statusCode = 500; res.end(String(e.message)); }
}).listen(PORT, '0.0.0.0', () => console.log(`Reddit Video Studio on http://0.0.0.0:${PORT}`));
