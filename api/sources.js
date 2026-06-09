// api/sources.js — multi-source content proxy
// Hacker News: zero auth, always works
// The Guardian: free key from open-platform.theguardian.com (optional)
// Reddit: works if REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET env vars set

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { source = "hn", sort = "top", t = "week", limit = "10", query = "" } = req.query;
  const n = Math.min(Math.max(parseInt(limit) || 10, 1), 25);

  try {
    let posts = [];

    // ── HACKER NEWS ──────────────────────────────────────────────
    if (source === "hn") {
      const listMap = { top: "topstories", new: "newstories", best: "beststories" };
      const listKey = listMap[sort] || "topstories";
      const idsRes = await fetch(`https://hacker-news.firebaseio.com/v0/${listKey}.json`);
      const ids = await idsRes.json();
      const topIds = ids.slice(0, n * 3); // fetch extra, filter empties
      const items = await Promise.all(
        topIds.map(id =>
          fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())
        )
      );
      posts = items
        .filter(i => i && i.title && i.score > 50)
        .slice(0, n)
        .map(i => ({
          id: i.id,
          title: i.title,
          score: i.score,
          num_comments: i.descendants || 0,
          author: i.by,
          url: i.url || `https://news.ycombinator.com/item?id=${i.id}`,
          selftext: i.text || "",
          source: "hn",
          created_utc: i.time,
        }));
    }

    // ── THE GUARDIAN ─────────────────────────────────────────────
    else if (source === "guardian") {
      const apiKey = process.env.GUARDIAN_API_KEY || "test";
      const section = query || "technology";
      const url = `https://content.guardianapis.com/search?api-key=${apiKey}&section=${section}&show-fields=headline,bodyText,thumbnail&page-size=${n}&order-by=relevance`;
      const gRes = await fetch(url);
      const gData = await gRes.json();
      if (!gRes.ok) throw new Error(`Guardian: ${gData.message || gRes.status}`);
      posts = (gData.response?.results || []).map((r, i) => ({
        id: r.id,
        title: r.webTitle,
        score: 1000 - i * 50,
        num_comments: 0,
        author: "The Guardian",
        url: r.webUrl,
        selftext: r.fields?.bodyText?.slice(0, 500) || "",
        source: "guardian",
        created_utc: new Date(r.webPublicationDate).getTime() / 1000,
        thumbnail: r.fields?.thumbnail || "",
      }));
    }

    // ── REDDIT (OAuth2, requires env vars) ───────────────────────
    else if (source === "reddit") {
      const sub = (query || "todayilearned").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 50);
      const validSorts = ["hot","top","new","rising"];
      const validTimes = ["hour","day","week","month","year","all"];
      const cleanSort = validSorts.includes(sort) ? sort : "top";
      const cleanTime = validTimes.includes(t) ? t : "week";
      const clientId = process.env.REDDIT_CLIENT_ID;
      const clientSecret = process.env.REDDIT_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(503).json({ error: "Reddit requires REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET env vars. Use HN or Guardian instead." });
      }
      const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "RedditVideoStudio/1.0",
        },
        body: "grant_type=client_credentials",
      });
      const tokenData = await tokenRes.json();
      const rRes = await fetch(
        `https://oauth.reddit.com/r/${sub}/${cleanSort}.json?t=${cleanTime}&limit=${n}&raw_json=1`,
        { headers: { "Authorization": `Bearer ${tokenData.access_token}`, "User-Agent": "RedditVideoStudio/1.0" } }
      );
      const rData = await rRes.json();
      posts = rData.data.children.map(c => ({
        id: c.data.id,
        title: c.data.title,
        score: c.data.score,
        num_comments: c.data.num_comments,
        author: c.data.author,
        url: c.data.url,
        selftext: c.data.selftext?.slice(0, 500) || "",
        source: "reddit",
        created_utc: c.data.created_utc,
        thumbnail: c.data.thumbnail || "",
      }));
    }

    else {
      return res.status(400).json({ error: `Unknown source: ${source}. Use hn, guardian, or reddit.` });
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json({ posts, source, count: posts.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
