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
