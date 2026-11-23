# eBird Needs Map — Deployment & Development

## Layout

```
index.html                     # The app (MapLibre map, all UI)
demo-data.js                   # Fake data for demo mode (?demo)
demo-server.mjs                # Local static server for demo mode
api/birds.js                   # Vercel serverless function (eBird API logic)
ebird_world_life_list.csv      # Life list export (read by the API, not served)
ebird_world_year_list.csv      # Year list export (read by the API, not served)
photoCount/                    # Separate script: species that still need a photo
vercel.json                    # Routes: only index.html, demo-data.js and /api are public
```

## Deploying to Vercel

1. Import the GitHub repo in Vercel (Framework preset: **Other**, no build command,
   output directory `.`).
2. Add the environment variable `EBIRD_API_KEY` (all environments).
3. Deploy. Every push to `main` redeploys automatically.

The API key stays server-side. `vercel.json` only serves `index.html`,
`demo-data.js` and `/api/*`; everything else (including the CSVs) returns 404.

## Updating the life/year lists

```bash
npm run download-lists   # uses ../life-list-download (Playwright)
git commit -am "Update lists" && git push
```

Species are matched by scientific name (falling back to common name), so eBird's
yearly common-name changes don't cause false "needs". Only `species` rows count;
spuh/slash/hybrid rows are ignored. The year list needs re-downloading after Jan 1.

## Local development

```bash
npm install
npm run demo        # http://localhost:3000/?demo — fake data, no eBird calls
```

Opening `index.html` directly from disk also runs in demo mode. To hit the real API
locally, use `vercel dev` with `EBIRD_API_KEY` in `.env`.

## Troubleshooting

- **"EBIRD_API_KEY not configured"**: set it in Vercel → Settings → Environment
  Variables, then redeploy.
- **"eBird rate limit reached"**: the API makes one eBird request per needed species;
  use "Load more birds" to fetch the rest.
- **No birds showing**: check the CSVs are committed and the browser console for errors.
