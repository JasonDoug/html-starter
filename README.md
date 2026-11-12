# Reddit Video Studio

Browser-native video automation pipeline deployed on Vercel.

## Sources
- **Hacker News** — zero setup, works immediately
- **The Guardian** — set `GUARDIAN_API_KEY` in Vercel env vars
- **Reddit** — set `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` in Vercel env vars

## Stack
- Content scraping via serverless `/api/sources` proxy
- Script generation via Claude API
- Voiceover via Web Speech API (word-level timing)
- Ken Burns canvas animation
- FFmpeg.wasm video assembly
- YouTube Data API v3 upload + Analytics dashboard

## Run locally (no Vercel)
```
git clone https://github.com/JasonDoug/html-starter && cd html-starter
node server.mjs          # http://localhost:3000
# or: docker compose up -d --build
```
The local server fetches Reddit RSS from your own IP via `/api/rss`, which avoids shared-proxy rate limits.
