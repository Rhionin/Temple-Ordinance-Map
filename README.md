# Temple Ordinance Map

People upload a FamilySearch **Completed Ordinances** CSV (`familysearch.org` → Temple → Completed Ordinances → Download List).
The server keeps rows completed in the past 12 months, pulls the place from the qualifying-event column
(e.g. `Birth, 1885, Patrixbourne, Kent` → `Patrixbourne, Kent`), geocodes it, and the TV page shows it as a light on a world map.

## Run

Node 18+, no npm dependencies.

```
npm start                                          # http://localhost:3000  (upload) and /tv (TV display)
node server.js                                     # same
node server.js ingest path/to/completed.csv        # bulk-load a CSV from the command line
GEOCODE_UA="temple-ordinance-map/1.0 (you@example.com)" PORT=8080 node server.js
npm test                                           # node --test test/
```

Reset stored lights by deleting `data/lights.json`. Keep `data/geocache.json` to avoid re-geocoding.

## How it works

- `POST /api/upload` (raw CSV body) parses the file, keeps dates on or after today−1 year, dedupes by FamilySearch person ID across uploads, geocodes, and stores the result.
- Geocoding uses Nominatim, waits at least 1.1 s between requests, and sends a User-Agent (`GEOCODE_UA`; set it to a real contact address). Results are cached in `data/geocache.json`.
  Fallbacks: full place → parish/sogn/amt/county words stripped → first + last segment → drop leading segments → drop trailing segments. Failures are appended to `data/unresolved.log`.
- TV page `/tv`: Leaflet plus self-hosted Natural Earth country outlines (no tile key), glowing flickering lights, a counter, and a place ticker. Live updates use SSE (`/api/stream`); the first paint comes from `/api/lights` (place + lat/lon only).
- The upload page detects iPhone vs Android (override with `?os=ios|android`) and explains how to open the list in the mobile browser.
  FamilySearch's apple-app-site-association claims `/temple/completed` and `/*/temple/completed` for the Family Tree app, so the button uses the trailing-slash URL `/en/temple/completed/` plus a copy-and-paste fallback (typed URLs open in the browser).
- The file input accepts `.csv`, `.txt`, and `text/csv`. The page checks for a qualifying-event column instead of trusting the filename.

## Deploy

- **Render / Fly.io / Railway**: run `node server.js` or `npm start`. The process honors `PORT`. Put `data/` on a persistent disk, or accept a fresh start. A geocache file can be pre-seeded.
- **Cloudflare**: port to Workers with KV or D1 for lights, and a Durable Object or polling in place of SSE. Serve `public/` as static assets.
- A laptop on the same display can be exposed with `cloudflared tunnel --url http://localhost:3000`. Put that URL in a QR code.

## Privacy

- Names are never stored. Uploads are processed in memory. Each light stores a FamilySearch person ID (dedupe only), place, lat/lon, and ordinance type.
- The TV page and `/api/lights` expose only place names and coordinates — no names, IDs, ordinance types, or temples.
- Place strings are sent to OpenStreetMap Nominatim for geocoding. Names and IDs are not sent.
- Delete `data/lights.json` when you are done. People share their own lists voluntarily. This app does not use the FamilySearch API or any FamilySearch credentials.
- Do not commit real exports. `data/`, logs, `*.real.csv`, and `test/fixtures/real-*.csv` are gitignored. The repository contains synthetic fixtures only.

## Multilingual CSVs

`lib/fscsv.js` ignores header text. Columns are found by position (FamilySearch's site writes 6 fixed columns) and validated by content (person-ID pattern `^[A-Z0-9]{4}-[A-Z0-9]{2,4}$`, a qualifying event that contains commas). It handles a BOM, CRLF, quoted commas, and `;` or tab delimiters.

Dates use month-name tables generated with `Intl.DateTimeFormat` for about 55 locales, plus numeric and CJK (`年月日` / `년월일`) forms. Unparseable dates are **included** and logged to `data/unresolved.log`.

`headers-by-locale.json` holds translated header strings from FamilySearch's public locale bundles (reference only).

Tests: `npm test` or `node --test test/`. Fixtures named `synthetic-*` are made up. `test/fixtures/real-cj-en.csv` is optional: the matching test runs if you add that file locally, and skips when it is absent. `test/package.json` sets `main` to the suite so `node --test test/` still runs it on Node versions that execute a directory argument as a file.
