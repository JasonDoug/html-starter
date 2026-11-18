// api/arctic.js — proxy to the Arctic Shift Reddit archive (works from Vercel, avoids browser CORS issues)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const qs = new URLSearchParams(req.query).toString();
  try {
    const r = await fetch("https://arctic-shift.photon-reddit.com/api/posts/search?" + qs, {
      headers: { "User-Agent": "RedditVideoStudio/1.0" },
    });
    const body = await r.text();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=60");
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
