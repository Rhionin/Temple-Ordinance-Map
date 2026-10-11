# Temple Ordinance Map

People upload a FamilySearch **Completed Ordinances** CSV (`familysearch.org` → Temple → Completed Ordinances → Download List).
The server keeps rows completed in the past 12 months, pulls the place from the qualifying-event column
(e.g. `Birth, 1885, Patrixbourne, Kent` → `Patrixbourne, Kent`), geocodes it, and the TV page shows it as a light on a world map.

The same pages and API run locally in Node, or on Cloudflare Workers for a public hostname.

## Run locally

Node 18+. The Node server has no runtime dependencies.

```
npm start                                          # http://localhost:3000  (upload) and /tv (TV display)
node server.js                                     # same
node server.js ingest path/to/completed.csv        # bulk-load a CSV from the command line
GEOCODE_UA="temple-ordinance-map/1.0 (you@example.com)" PORT=8080 node server.js
RESET_TOKEN="a-long-random-string" npm start       # enables POST /api/reset
npm test                                           # node --test test/
```

Local uploads geocode before the response returns. Reset stored lights by deleting `data/lights.json`, or:

```
curl -X POST -H "Authorization: Bearer $RESET_TOKEN" http://localhost:3000/api/reset
```

Keep `data/geocache.json` so the next run does not geocode the same places again.

## Deploy on Cloudflare

The Worker serves `public/` as static assets, stores lights in D1, and paces Nominatim through one Durable Object so a multi-row upload stays at or under one request per second. Lights show up on the TV as each place resolves. A subdomain of rhionin.com (the zone is on the same Cloudflare account) is the straightforward host. The app’s routes are `/`, `/tv`, and `/api`, so a path on the apex would not line up without extra rewriting.

1. `npm install` (installs Wrangler).
2. `npx wrangler login` with the Cloudflare account that owns the rhionin.com zone.
3. `npx wrangler d1 create temple-ordinance-map`
4. Replace the placeholder `database_id` in `wrangler.toml` with the id that command prints. Do not commit an account id.
5. `npm run db:migrate:remote` (or `npx wrangler d1 migrations apply temple-ordinance-map --remote`).
6. Set secrets (they are not in the repo):

   ```
   npx wrangler secret put GEOCODE_UA
   # temple-ordinance-map/1.0 (you@example.com)
   npx wrangler secret put RESET_TOKEN
   ```

   Nominatim requires a User-Agent that identifies this app and a contact. The Worker will not call Nominatim until `GEOCODE_UA` is set.
7. `npm run deploy` (or `npx wrangler deploy`). This publishes a `*.workers.dev` hostname.
8. Attach a hostname on the rhionin.com zone, for example `lights.rhionin.com`:
   - Dashboard: Workers & Pages → temple-ordinance-map → Settings → Domains & Routes, or
   - uncomment the `[[routes]]` block in `wrangler.toml` (`pattern = "lights.rhionin.com"`, `custom_domain = true`) and deploy again.

For a local Worker with the D1 simulator:

```
cp .dev.vars.example .dev.vars   # then edit the contact and token
npm run db:migrate:local
npm run dev:worker               # http://localhost:8787
```

Clear lights before an event (the geocode cache is kept):

```
curl -X POST -H "Authorization: Bearer $RESET_TOKEN" https://lights.rhionin.com/api/reset
```

## How it works

- `POST /api/upload` (raw CSV body) parses the file, keeps dates on or after today−1 year, and dedupes by FamilySearch person ID across uploads.
- Places already in the geocode cache become lights immediately. The rest are queued. On the Worker, a Durable Object alarm calls Nominatim at least 1.1 s apart and writes each light as it resolves. Locally, Node does that pacing inside the upload request.
- Fallbacks: full place → parish/sogn/amt/county words stripped → first + last segment → drop leading segments → drop trailing segments. Failed lookups are cached so they are not retried. The Node server also appends them to `data/unresolved.log`.
- `GET /api/lights?since=<unix ms>` returns place, lat, lon, and created time for lights newer than `since`. The TV page polls this about every 2 seconds. The local server still offers `/api/stream` (SSE); the page does not depend on it.
- `POST /api/reset` with `Authorization: Bearer $RESET_TOKEN` deletes lights and pending geocode jobs. It does not delete the place cache. If `RESET_TOKEN` is unset, the route responds 503.
- The upload page detects iPhone vs Android (override with `?os=ios|android`) and explains how to open the list in the mobile browser.
  FamilySearch's apple-app-site-association claims `/temple/completed` and `/*/temple/completed` for the Family Tree app, so the button uses the trailing-slash URL `/en/temple/completed/` plus a copy-and-paste fallback (typed URLs open in the browser).
- The file input accepts `.csv`, `.txt`, and `text/csv`. The page checks for a qualifying-event column instead of trusting the filename.
- TV page `/tv`: Leaflet plus self-hosted Natural Earth country outlines (no tile key), glowing flickering lights, a counter, and a place ticker.

Other hosts (Render, Fly.io, Railway) can still run `node server.js`. The process honors `PORT`. Put `data/` on a persistent disk, or accept a fresh start.

## Privacy

- Names are never stored. Uploads are processed in memory. Each light stores a FamilySearch person ID (dedupe only), place, lat/lon, ordinance type, and the time it was created.
- The TV page and `/api/lights` expose place names, coordinates, and that created time so the display can ask for new lights. They do not expose names, person IDs, ordinance types, or temples.
- Place strings are sent to OpenStreetMap Nominatim for geocoding. Names and IDs are not sent.
- `POST /api/reset`, or deleting `data/lights.json` locally, clears lights when you are done. The place cache can stay.
- People share their own lists voluntarily. This app does not use the FamilySearch API or any FamilySearch credentials.
- Do not commit real exports. `data/`, logs, `*.real.csv`, `test/fixtures/real-*.csv`, `.dev.vars`, and `.wrangler/` are gitignored. The repository contains synthetic fixtures only.

## Multilingual CSVs

`lib/fscsv.js` ignores header text. Columns are found by position (FamilySearch's site writes 6 fixed columns) and validated by content (person-ID pattern `^[A-Z0-9]{4}-[A-Z0-9]{2,4}$`, a qualifying event that contains commas). It handles a BOM, CRLF, quoted commas, and `;` or tab delimiters.

Dates use month-name tables generated with `Intl.DateTimeFormat` for about 55 locales, plus numeric and CJK (`年月日` / `년월일`) forms. Unparseable dates are **included**. The Node server logs them to `data/unresolved.log`.

`headers-by-locale.json` holds translated header strings from FamilySearch's public locale bundles (reference only).

Tests: `npm test` or `node --test test/`. Fixtures named `synthetic-*` are made up. `test/fixtures/real-cj-en.csv` is optional: the matching test runs if you add that file locally, and skips when it is absent. `test/package.json` points `main` at `test/run.js`, which loads every `*.test.js` file, so `node --test test/` still runs the full suite on Node versions that execute a directory argument as a file.
