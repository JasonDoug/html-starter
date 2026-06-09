// api/reddit.js — Vercel serverless Reddit proxy
// Uses Reddit OAuth2 app-only flow (client_credentials) to bypass datacenter IP blocks.
// Falls back to public JSON endpoint if no credentials configured.
// Set env vars in Vercel dashboard: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { sub = "todayilearned", sort = "top", t = "week", limit = "10" } = req.query;
  const cleanSub = sub.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 50);
  const validSorts = ["hot", "top", "new", "rising"];
  const validTimes = ["hour", "day", "week", "month", "year", "all"];
  const cleanSort = validSorts.includes(sort) ? sort : "top";
  const cleanTime = validTimes.includes(t) ? t : "week";
  const cleanLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 25);

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  try {
    let accessToken = null;

    // Use OAuth2 app-only flow if credentials are set — bypasses datacenter IP block
    if (clientId && clientSecret) {
      const tokenRes = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "RedditVideoStudio/1.0 by jpotter702",
        },
        body: "grant_type=client_credentials",
      });
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        accessToken = tokenData.access_token;
      }
    }

    const apiBase = accessToken ? "https://oauth.reddit.com" : "https://www.reddit.com";
    const url = `${apiBase}/r/${cleanSub}/${cleanSort}.json?t=${cleanTime}&limit=${cleanLimit}&raw_json=1`;

    const headers = {
      "User-Agent": "RedditVideoStudio/1.0 by jpotter702",
      "Accept": "application/json",
    };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Reddit returned ${response.status}`,
        hint: response.status === 403
          ? "Add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET env vars in Vercel dashboard to use OAuth2 and bypass IP blocks."
          : "Check subreddit name",
      });
    }

    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
