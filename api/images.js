// api/images.js — Pexels image search proxy
// Set PEXELS_API_KEY in Vercel env vars (free at pexels.com/api)
// Falls back to Unsplash source URLs if no key set

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { query = "nature", count = "6", orientation = "portrait" } = req.query;
  const n = Math.min(Math.max(parseInt(count) || 6, 1), 15);
  const pexelsKey = process.env.PEXELS_API_KEY;

  try {
    if (pexelsKey) {
      // ── Pexels ───────────────────────────────────────────────────────────
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${n}&orientation=${orientation}`;
      const r = await fetch(url, { headers: { Authorization: pexelsKey } });
      if (!r.ok) throw new Error(`Pexels ${r.status}`);
      const data = await r.json();
      const photos = data.photos.map(p => ({
        id: p.id,
        url: orientation === "portrait" ? p.src.portrait : p.src.landscape,
        thumb: p.src.medium,
        photographer: p.photographer,
        source: "pexels",
      }));
      res.setHeader("Cache-Control", "s-maxage=3600");
      return res.status(200).json({ photos, query, source: "pexels" });
    } else {
      // ── Unsplash source (no key needed, random high-quality images) ──────
      const topics = query.split(" ").slice(0, 2).join(",");
      const w = orientation === "portrait" ? 1080 : 1920;
      const h = orientation === "portrait" ? 1920 : 1080;
      const photos = Array.from({ length: n }, (_, i) => ({
        id: i,
        url: `https://source.unsplash.com/${w}x${h}/?${encodeURIComponent(topics)}&sig=${i}`,
        thumb: `https://source.unsplash.com/400x300/?${encodeURIComponent(topics)}&sig=${i}`,
        photographer: "Unsplash",
        source: "unsplash",
      }));
      res.setHeader("Cache-Control", "s-maxage=3600");
      return res.status(200).json({ photos, query, source: "unsplash (no Pexels key set)" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
