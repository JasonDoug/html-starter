// api/reddit.js — Vercel serverless Reddit proxy
// Replaces corsproxy.io entirely. Called as /api/reddit?sub=...&sort=...&t=...&limit=...

export default async function handler(req, res) {
  // CORS headers so the frontend can call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { sub = 'todayilearned', sort = 'top', t = 'week', limit = '10' } = req.query;

  // Sanitize inputs
  const cleanSub = sub.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50);
  const validSorts = ['hot', 'top', 'new', 'rising'];
  const validTimes = ['hour', 'day', 'week', 'month', 'year', 'all'];
  const cleanSort = validSorts.includes(sort) ? sort : 'top';
  const cleanTime = validTimes.includes(t) ? t : 'week';
  const cleanLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 25);

  const url = `https://www.reddit.com/r/${cleanSub}/${cleanSort}.json?t=${cleanTime}&limit=${cleanLimit}&raw_json=1`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'RedditVideoStudio/1.0 (Vercel serverless; contact via GitHub)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Reddit returned ${response.status}`,
        sub: cleanSub,
      });
    }

    const data = await response.json();

    // Cache for 5 minutes on Vercel edge
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
