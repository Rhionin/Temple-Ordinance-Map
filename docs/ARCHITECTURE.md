# Architecture

Guests upload a FamilySearch Completed Ordinances CSV from a phone. The TV page draws one light per ancestor place. The public host is temple-ordinance-map.rhionin.com. The event is 29 October 2026.

This note describes `main` after the timeline, spotlight fly-to, English ordinance names, TV totals, PIN reset, and deploy reload landed. The overnight audit changes are still separate pull requests.

## Stored light

One FamilySearch person is one light. The D1 row holds the person id, the place, latitude, longitude, ordinance types, `created`, `updated`, `month`, `completed`, and `country`. The person id is the dedupe key. Names and temple names are not written. `GET /api/lights` returns `place`, `lat`, `lon`, `created`, `updated`, `ordinances`, and `month`. It does not return the person id, the completion day, or the country code.

Ordinance types share one text column. The value is a JSON array of English FamilySearch labels. An older plain string still reads as a one-item list. `lib/ordinance-names.js` maps known translations onto those six English names at parse time. An unknown label is kept and logged once.

Rows from the past year are kept. A row whose date does not parse is kept too, with a null month. Older dated rows are dropped. `month` is `YYYY-MM` and is the earliest past-year ordinance date for that person. `completed` is that same date as `YYYY-MM-DD`. A public light with a null month and a stored day uses the day. Rows saved before either column existed stay undated until the same CSV is uploaded again. The TV does not show an unknown-date step: a public light whose month is still null is placed in one of the twelve timeline months by a stable hash of the person id, or of the place and created time when the id is not on the payload.

`country` is an ISO code. Nominatim supplies it when a place is fetched. `lib/country.js` fills a missing code from the Natural Earth outlines. `GET /api/stats` counts ancestors, countries, ordinance types, and people who shared a list. A sharer is a hash of the browser id in `X-Sharer`, or a hash of the person ids in the file. The hash is not a name. Reset deletes lights, jobs, and sharer hashes. The place cache stays.

## Two runtimes, one API

`lib/http.js` implements `POST /api/upload`, `GET /api/lights`, `GET /api/stats`, `GET /api/version`, and `POST /api/reset`. `src/worker.js` serves that API on Cloudflare. `server.js` serves it under Node for local use. Static files live in `public/`. The Worker assets binding serves them. `run_worker_first` is `/api/*`, `/`, `/new`, `/admin`, and `/g/*`. `/admin` asks for PIN `1337` and lists groups. The pin is hard-coded and is not a URL. HTML pages and `/version.js` are sent with `Cache-Control: no-cache` so a new deploy can reload open screens.

An upload is parsed by `lib/fscsv.js`. Columns are chosen by position and by the shape of the cells, not by header words. `lib/rows.js` drops names and temples and applies the date cutoff. `lib/upload.js` groups rows by person id, merges ordinance types onto that person, and splits cache hits from places that still need a lookup.

The upload body is refused when `Content-Length` is over 5,000,000 bytes. `POST /api/reset` deletes lights and geocode jobs when the `Authorization` bearer token matches `RESET_TOKEN`, or when the PIN matches `RESET_PIN` (default `1337`) in `X-Reset-Pin` or a JSON body. The place cache is kept. With no PIN and no token, the route returns 503.

## Geocoding

`lib/places.js` turns one place string into an ordered list of Nominatim queries. The full string comes first. Later queries drop parish words and then drop segments from either end. `lib/geostep.js` allows one Nominatim fetch at a time, and never sooner than 1.1 seconds after the previous fetch. A cache hit or a known miss does not count as a fetch. HTTP 401 and 403 wait 60 seconds. Other HTTP failures, including 429 and 503, wait 5 seconds and are not cached.

On the Worker, lights, the place cache, the job queue, and sharer hashes are D1 tables from `migrations/`. `src/d1.js` is the store. One `Geocoder` Durable Object is the pacer for the whole map. Its alarm reads the oldest pending job, calls Nominatim, and inserts the light with month and country. The upload response returns as soon as the jobs are queued. `kick()` sets an alarm only when none is already set. The alarm handles at most 40 jobs per wake. A wake that stops on a network fetch schedules the next wake. A wake that only resolves cache hits does not.

Node geocodes inside the upload request. It stores `data/lights.json`, `data/geocache.json`, and `data/sharers.json` on disk. An HTTP error from Nominatim is treated as an empty result on that path.

## Phone page and TV page

`public/upload.html` is the phone page. It detects iPhone and Android and tells the guest to scroll to Download List. The guest picks a CSV. The page looks for a person id in the file, then posts the text with `X-Sharer`. It then polls lights until the new lights have all appeared, or until 180 seconds have passed. Open pages poll `GET /api/version` about every 60 seconds. The upload page reloads only while it is idle.

`public/tv.html` polls `GET /api/lights?since=` about every 2 seconds and `GET /api/stats` for the totals panel. The default show plays one timeline of the past 12 months, then spotlight stops, and repeats. `?mode=timeline` and `?mode=spotlight` stay on one mode. `public/timeline.js` reveals lights in their completion month, and folds a null month into that same twelve-month window. `public/spotlight.js` shows new lights first, then a shuffle, and returns to the whole world every fourth light. Country outlines stay painted while the view flies. Place and ordinance text is set with `textContent`. A faint control accepts PIN `1337` and posts `/api/reset`. The TV reloads on a new build at the next spotlight step, or when a timeline cycle ends.

The map is Leaflet 1.9.4 loaded from unpkg.com. Country outlines are the self-hosted file `public/world.geojson`. That file is Natural Earth, 177 features, 838726 bytes. There is no tile server.

## Deploy and tests

A push to `main` runs `.github/workflows/deploy.yml`. The job runs `node --test test/`, applies D1 migrations, and runs `wrangler deploy` with `BUILD_ID` set to the commit. It does not call `/api/reset` and it does not set `RESET_TOKEN`. `GEOCODE_UA` is a var in `wrangler.toml`. Pull requests run the `Tests` job in `.github/workflows/ci.yml`.

## Still open from the overnight audit

These are not in this tree. Each one is its own pull request.

- A cache-hit batch of 40 jobs can leave the rest of the queue without an alarm.
- Nominatim 429 and 503 retry after 5 seconds.
- One file can queue an unbounded number of new places. A burst of about 30 phones can fill the one-request-per-second pacer.
- Leaflet is loaded from unpkg.com, so the TV depends on that host.
- Responses do not send a content security policy or frame denial.
- Place and ordinance text is stored as parsed, including a leading formula mark or a bidi override.

Issues #23 through #30 are filed and not implemented. #26 is a sweeper for a missed `kick()`. It was left out because a cron would change the Worker schedule. #30 is an upload passphrase, which only CJ can choose. Issues #7, #8, #9, #10, and #13 were already tracked before this audit.
