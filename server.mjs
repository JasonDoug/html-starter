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
      const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) RedditVideoStudio/1.0', Accept: 'application/atom+xml,application/xml,text/xml' } });
      res.statusCode = r.status;
      res.setHeader('Content-Type', 'application/xml');
      return res.end(await r.text());
    }
    const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    if (file.includes('..') || file.startsWith('api') || file === 'server.mjs') { res.statusCode = 404; return res.end('Not found'); }
    const data = fs.readFileSync(path.join(dir, file));
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(data);
  } catch (e) { res.statusCode = 500; res.end(String(e.message)); }
}).listen(PORT, '0.0.0.0', () => console.log(`Reddit Video Studio on http://0.0.0.0:${PORT}`));
