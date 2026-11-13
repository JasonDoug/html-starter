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
      if (c && Date.now() - c.t < 5 * 60 * 1000) { res.statusCode = 200; return res.end(c.body); }
      let r, body;
      for (let i = 0; i < 3; i++) {
        r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) RedditVideoStudio/1.0', Accept: 'application/atom+xml,application/xml,text/xml' }, signal: AbortSignal.timeout(15000) });
        body = await r.text();
        if (r.status !== 429 && r.status < 500) break;
        const ra = parseInt(r.headers.get('retry-after')) || (2 + i * 3);
        await sleep(Math.min(ra, 8) * 1000);
      }
      if (r.ok) rssCache.set(key, { t: Date.now(), body });
      else if (c) { res.statusCode = 200; return res.end(c.body); } // serve stale on failure
      res.statusCode = r.status;
      return res.end(body);
    }
    const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    if (file.includes('..') || file.startsWith('api') || file === 'server.mjs') { res.statusCode = 404; return res.end('Not found'); }
    const data = fs.readFileSync(path.join(dir, file));
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(data);
  } catch (e) { res.statusCode = 500; res.end(String(e.message)); }
}).listen(PORT, '0.0.0.0', () => console.log(`Reddit Video Studio on http://0.0.0.0:${PORT}`));
