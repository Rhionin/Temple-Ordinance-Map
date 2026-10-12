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
RESET_PIN="1337" npm start                          # optional; the TV PIN defaults to 1337
npm test                                           # node --test test/
```

Local uploads geocode before the response returns. Reset stored lights by deleting `data/lights.json`, or:

```
curl -X POST -H "Authorization: Bearer $RESET_TOKEN" http://localhost:3000/api/reset
curl -X POST -H "Content-Type: application/json" -d '{"pin":"1337"}' http://localhost:3000/api/reset
```

The TV page also has a faint reset control in the top-right corner. It appears when the pointer moves or the screen is tapped. The PIN on that page is `1337`. A correct PIN asks “Clear all lights and start over?” and then clears the lights. `RESET_PIN` overrides the server PIN (default `1337`). If you change it, the page still sends `1337` until that constant is updated. Keep `data/geocache.json` so the next run does not geocode the same places again.

## Deploy on Cloudflare

The Worker serves `public/` as static assets, stores lights in D1, and paces Nominatim through one Durable Object so a multi-row upload stays at or under one request per second. Lights show up on the TV as each place resolves. The hostname is `temple-ordinance-map.rhionin.com` (`custom_domain = true` in `wrangler.toml`). The app’s routes are `/`, `/tv`, and `/api`, so a path on the apex would not line up without extra rewriting.

`wrangler.toml` already names the worker `temple-ordinance-map`, the D1 database `temple-ordinance-map` (`database_id` `3ac5318c-7b9f-45d5-a5d0-862076f3e4b2`), and the SQLite Durable Object class `Geocoder` (migration tag `v1`). Do not commit an account id. `GEOCODE_UA` is a `[vars]` value. `RESET_TOKEN` stays a secret and is not set by deploys.

Pushes to `main` run `.github/workflows/deploy.yml` (Node 22): tests, then `node scripts/prepare-d1-migrations.js`, then `npx wrangler d1 migrations apply temple-ordinance-map --remote`, then `npx wrangler deploy --var BUILD_ID:<commit sha>`. A second run for the same ref waits until the first finishes. The Worker deploy tries up to 3 times, waiting 60 seconds after a failure. The same workflow can be started with `workflow_dispatch`. It never calls `/api/reset` and does not write secrets. `BUILD_ID` is the commit that was deployed. `GET /api/version` returns it. Open pages poll that about every 60 seconds. The TV reloads at the next spotlight step, or when a timeline cycle ends, before the following fly. The upload page reloads only while it is idle; otherwise it shows **Updated, refresh** and does not interrupt an upload.

The GitHub secret `CLOUDFLARE_API_TOKEN` must be set on the repository (Workers Scripts:Edit, D1:Edit, and access to account `cdaf2135c9b5b619074a6cfbb97f49af`). The account id is the workflow env var `CLOUDFLARE_ACCOUNT_ID`, not a secret. Migrations 0001 and 0002 were originally applied outside Wrangler, so the remote database may have the tables without `d1_migrations` rows. The prepare script inserts those rows only when the matching schema is already there (`0001` if `lights` exists, `0002` as well if `lights.updated` exists). A new database is left for Wrangler to migrate. `0002` stays a plain `ALTER TABLE` so a fresh database still gains the column.

To deploy by hand:

1. `npm install` (installs Wrangler).
2. `npx wrangler login` with the Cloudflare account that owns the rhionin.com zone.
3. `node scripts/prepare-d1-migrations.js`
4. `npm run db:migrate:remote` (or `npx wrangler d1 migrations apply temple-ordinance-map --remote`).
5. If `RESET_TOKEN` is not set yet: `npx wrangler secret put RESET_TOKEN`
6. `npm run deploy` (or `npx wrangler deploy`).

For a local Worker with the D1 simulator:

```
cp .dev.vars.example .dev.vars   # then edit the contact and token
npm run db:migrate:local
npm run dev:worker               # http://localhost:8787
```

Clear lights before an event (the geocode cache is kept):

```
curl -X POST -H "Authorization: Bearer $RESET_TOKEN" https://temple-ordinance-map.rhionin.com/api/reset
```

## How it works

- `POST /api/upload` (raw CSV body) parses the file, keeps dates on or after today−1 year, and dedupes by FamilySearch person ID across uploads. One person is one light. If the list has more than one ordinance for that person, those types are merged onto the light. Ordinance names are stored and shown as the English FamilySearch labels (Baptism, Confirmation, Initiatory, Endowment, Sealing to Parents, Sealing to Spouse), including rows already saved in another language. Place names stay as recorded. An unrecognized ordinance is kept as written and logged once.
- Places already in the geocode cache become lights immediately. The rest are queued. On the Worker, a Durable Object alarm calls Nominatim at least 1.1 s apart and writes each light as it resolves. Locally, Node does that pacing inside the upload request.
- Fallbacks: full place → parish/sogn/amt/county words stripped → first + last segment → drop leading segments → drop trailing segments. Failed lookups are cached so they are not retried. The Node server also appends them to `data/unresolved.log`.
- `GET /api/lights?since=<unix ms>` returns place, lat, lon, created time, updated time, ordinance types, and completion month (`YYYY-MM`) for lights newer than `since` (a light whose ordinance list just grew is included). The month is the earliest past-year ordinance date for that person. It is null when the date did not parse. If the month is missing and the completion day is stored, the month is taken from that day. The day itself is not returned. The TV page polls this about every 2 seconds. The local server still offers `/api/stream` (SSE); the page does not depend on it.
- `GET /api/stats` returns the totals on the TV: ancestors (one per light), countries, people who shared, and a count for each English ordinance name (Baptism, Confirmation, Initiatory, Endowment, Sealing to Parents, Sealing to Spouse). Those six numbers count ordinances, so one person with a baptism and an endowment adds one to each. The panel is the same in spotlight and timeline.
- `POST /api/reset` deletes lights and pending geocode jobs. It does not delete the place cache. Send `Authorization: Bearer $RESET_TOKEN`, or a PIN in the `X-Reset-Pin` header or JSON body `{ "pin": "1337" }`. The PIN defaults to `1337` and can be overridden with `RESET_PIN`. With no PIN and no `RESET_TOKEN`, the route responds 503. A wrong PIN with no token responds 401. A correct bearer token still works.
- The upload page detects iPhone vs Android (override with `?os=ios|android`) and explains how to open the list in the mobile browser.
  FamilySearch's apple-app-site-association claims `/temple/completed` and `/*/temple/completed` for the Family Tree app, so the button uses the trailing-slash URL `/en/temple/completed/` plus a copy-and-paste fallback (typed URLs open in the browser).
- The file input accepts `.csv`, `.txt`, and `text/csv`. The page checks for a qualifying-event column instead of trusting the filename.
- After an upload, the page confirms how many past-year ordinances were found, how many lights are new, and how many were already on the map, then links to `/tv`. While places are still being found, that new-light count updates.
- TV page `/tv`: Leaflet plus self-hosted Natural Earth country outlines (no tile key), glowing flickering lights, a counter, a totals panel, and a place ticker. The default page plays one timeline of the past 12 months, then a few spotlight stops, and repeats. `/tv?mode=timeline` stays on the timeline. `/tv?mode=spotlight` stays on the spotlight. `?cycle=75` sets the timeline length in seconds (about 60–90 by default).
- Timeline: a large month and year sits at the bottom with a thin progress bar. Lights appear when their completion month arrives, bloom, and the counter climbs. Undated lights come after the twelve months. The map holds on the full set, fades, and starts again. New uploads still show up on the next poll.
- Spotlight: about every 9 seconds the view pans to one light, that light blooms, and a card shows its place and ordinance types (and how many ancestors share that country). Newly arrived lights go first. The rest play in a shuffled order with no repeat until each has been shown. Every fourth light, the view returns to the whole world. With a single light it alternates between that light and the world. With none, it stays on the world.

Other hosts (Render, Fly.io, Railway) can still run `node server.js`. The process honors `PORT`. Put `data/` on a persistent disk, or accept a fresh start.

## Privacy

- Names are never stored. Uploads are processed in memory. Each light stores a FamilySearch person ID (dedupe only), place, lat/lon, an ISO country code, the ordinance types for that person, the completion day when the date parsed, and timestamps. The ID is not shown. The completion day is not included in `/api/lights`; the page receives the month only. The country code comes from Nominatim when a place is geocoded, and from the Natural Earth outlines when a light does not have one yet. It is not included in `/api/lights`.
- Someone who shares a list is counted once. The upload page keeps a random id in `localStorage` and sends it as `X-Sharer`. Only a hash of that id is stored. A request without the header is counted from a hash of the person ids in the file. The hash is not a name, and reset clears it along with the lights. The place cache stays.
- The TV page and `/api/lights` expose place names, coordinates, ordinance types, and timestamps so the display can ask for new lights and caption them. They do not expose names, person IDs, temples, or country codes. `/api/stats` exposes the totals only.
- Place strings are sent to OpenStreetMap Nominatim for geocoding. Names and IDs are not sent.
- `POST /api/reset`, or deleting `data/lights.json` locally, clears lights when you are done. The place cache can stay.
- People share their own lists voluntarily. This app does not use the FamilySearch API or any FamilySearch credentials.
- Do not commit real exports. `data/`, logs, `*.real.csv`, `test/fixtures/real-*.csv`, `.dev.vars`, and `.wrangler/` are gitignored. The repository contains synthetic fixtures only.

## Multilingual CSVs

`lib/fscsv.js` ignores header text. Columns are found by position (FamilySearch's site writes 6 fixed columns) and validated by content (person-ID pattern `^[A-Z0-9]{4}-[A-Z0-9]{2,4}$`, a qualifying event that contains commas). It handles a BOM, CRLF, quoted commas, and `;` or tab delimiters.

Dates use month-name tables generated with `Intl.DateTimeFormat` for about 55 locales, plus numeric and CJK (`年月日` / `년월일`) forms. Unparseable dates are **included**. The Node server logs them to `data/unresolved.log`.

`headers-by-locale.json` holds translated header strings from FamilySearch's public locale bundles (reference only).

Tests: `npm test` or `node --test test/`. Fixtures named `synthetic-*` are made up. `test/fixtures/real-cj-en.csv` is optional: the matching test runs if you add that file locally, and skips when it is absent. `test/package.json` points `main` at `test/run.js`, which loads every `*.test.js` file, so `node --test test/` still runs the full suite on Node versions that execute a directory argument as a file.
