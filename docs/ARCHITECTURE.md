# Architecture

Guests upload a FamilySearch Completed Ordinances CSV from a phone. The TV page draws one light per ancestor place. The public host is temple-ordinance-map.rhionin.com. The event is 29 October 2026.

## Stored light

One FamilySearch person is one light. The database row holds the person id, the place, latitude, longitude, ordinance types, `created`, and `updated`. The person id is the dedupe key. Names and temple names are not written. `GET /api/lights` returns `place`, `lat`, `lon`, `created`, `updated`, and `ordinances`. It does not return the person id.

Ordinance types share one text column. The value is a JSON array. An older plain string still reads as a one-item list.

Rows from the past year are kept. A row whose date does not parse is kept too. Older dated rows are dropped. Completion month is not a stored column on this tree.

## Two runtimes, one API

`lib/http.js` implements `POST /api/upload`, `GET /api/lights`, and `POST /api/reset`. `src/worker.js` serves that API on Cloudflare. `server.js` serves it under Node for local use. Static files live in `public/`. The Worker assets binding serves them. The Worker handles `/`, `/tv`, and `/api/*` before the asset layer.

An upload is parsed by `lib/fscsv.js`. Columns are chosen by position and by the shape of the cells, not by header words, so a Finnish or Korean export still parses. `lib/rows.js` drops names and temples and applies the date cutoff. `lib/upload.js` groups rows by person id, merges ordinance types onto that person, and splits cache hits from places that still need a lookup.

The upload body is refused when `Content-Length` or the buffered text is over 5,000,000 bytes. `POST /api/reset` deletes lights and geocode jobs when the `Authorization` bearer token matches `RESET_TOKEN`. The place cache is kept. If the token is unset, the route returns 503.

## Geocoding

`lib/places.js` turns one place string into an ordered list of Nominatim queries. The full string comes first. Later queries drop parish words and then drop segments from either end. `lib/geostep.js` allows one Nominatim fetch at a time, and never sooner than 1.1 seconds after the previous fetch. A cache hit or a known miss does not count as a fetch. HTTP 401 and 403 wait 60 seconds. Other HTTP failures wait 5 seconds and are not cached.

On the Worker, lights, the place cache, and the job queue are D1 tables from `migrations/`. `src/d1.js` is the store. One `Geocoder` Durable Object is the pacer for the whole map. Its alarm reads the oldest pending job, calls Nominatim, and inserts the light. The upload response returns as soon as the jobs are queued. The TV sees each light on a later poll. The alarm handles at most 40 jobs per wake, and it schedules the next wake after a network fetch. A wake that only resolves cache hits does not schedule another wake when it stops.

Node geocodes inside the upload request. It stores `data/lights.json` and `data/geocache.json` on disk.

## Phone page and TV page

`public/upload.html` is the phone page. It detects iPhone and Android and explains how to open the FamilySearch completed list in the mobile browser. The guest picks a CSV. The page looks for a person id in the file, then posts the text. It then polls lights until the new lights have all appeared, or until 180 seconds have passed.

`public/tv.html` polls `GET /api/lights?since=` about every 2 seconds. The first poll loads every light. Later polls send the newest timestamp they have seen. `public/spotlight.js` shows new lights first, then a shuffle, and returns to the whole world every fourth light. Place and ordinance text is set with `textContent`.

The map is Leaflet 1.9.4 loaded from unpkg.com. Country outlines are the self-hosted file `public/world.geojson`. That file is Natural Earth, 177 features, 838726 bytes. There is no tile server.

## Deploy and tests

A push to `main` runs `.github/workflows/deploy.yml`. The job runs `node --test test/`, applies D1 migrations, and runs `wrangler deploy`. It does not call `/api/reset` and it does not set `RESET_TOKEN`. `GEOCODE_UA` is a var in `wrangler.toml`. Pull requests run the `Tests` job in `.github/workflows/ci.yml`.

## Already open elsewhere

Issues #7, #8, #9, #10, and #13 are open. Pull requests #4, #5, #12, #14, and #15 cover the Download List instruction, a past-year timeline, the spotlight fly-to gap, reload after deploy, and a PIN reset. This note describes the tree that already contains the GitHub Actions deploy workflow.
