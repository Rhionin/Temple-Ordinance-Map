# Multi-tenant map

One Worker, one D1 database, and one Nominatim pacer serve every group. Each group has its own upload page and its own TV. A separate master TV draws every enabled group at once. The ward party already on the live site becomes the default group. `/` and `/tv` keep showing that group only.

This is a design. It does not change the running site.

## What is shared, and what is not

Shared: the geocache, the Durable Object that paces Nominatim, the Leaflet files, and the country outlines.

Not shared: lights, the geocode queue, sharer hashes, the PIN, the title, and the ordinance window. Resetting one group does not delete another.

A FamilySearch person id is the dedupe key inside a group, as it is today. The same person uploaded to two groups is stored twice, once in each group. Each group's TV and stats count that person. The master view counts them once.

## Groups

A `groups` row holds:

- `slug`, the URL name. Lowercase letters, digits, and hyphens, 2 to 32 characters. `all`, `g`, `tv`, `api`, `admin`, and `vendor` are reserved.
- `title` and `subtitle`, plain text, passed through the same label cleaning as place names. No custom CSS and no images.
- `months`, how many months of ordinances to keep. The ward stays at 12.
- `uploads_open` and `uploads_close`, optional timestamps. Null means uploads are always accepted. After close, the TV still shows the lights already stored.
- `pin`, the in-room reset code. The ward row keeps `1337`.
- `admin_token_hash`, a hash of that group's admin token. The token itself is shown once.
- `disabled`. A disabled group is hidden from its own URLs and from the master. Rows stay.

`/` is bound to one group. That binding is not a slug the public has to type. The recommended slug for the migrated ward is `ward`, so `/g/ward` is the same map as `/`.

## Lights, jobs, and sharers

`lights` and `jobs` gain `group_id`. The primary key becomes `(group_id, person_id)`. `sharers` becomes `(group_id, id_hash)`.

The geocache has no `group_id`. A place resolved for one group is a cache hit for every other group.

SQLite cannot alter a primary key in place. The migration builds new tables, copies every column (`place`, `lat`, `lon`, `ordinance`, `created`, `updated`, `month`, `country`, `completed`, job status and cursor), checks the row counts, then renames. A test seeds rows, runs that migration, and asserts the counts and those columns match. Existing live rows are the ward group. Nothing is deleted.

Every current read and write is scoped by group id. Until a second group exists, the only id is the ward, so `/`, `/tv`, and `/api/*` behave as they do now.

The geocoder stores `group_id` on the job and writes the finished light into that group. A slug upload must not ship before that write exists, or a second group's jobs would land on the wrong map.

`ids()`, `known()`, inserts, and stats follow the same scope. Those statements stay one row at a time. The geocache lookup stays chunked and is not filtered by group.

## Routes

| Who | Upload | TV | Lights and stats |
| --- | --- | --- | --- |
| Ward party (default group) | `/` | `/tv` | `/api/lights`, `/api/stats`, `/api/upload`, `/api/reset` |
| Any group, including the ward | `/g/<slug>` | `/g/<slug>/tv` | `/g/<slug>/api/...` |
| Master, every enabled group | none | `/all/tv` | `/all/api/lights`, `/all/api/stats` |

`/g/ward` and `/` are the same partition. `/all` has no upload. It only introduces the combined TV.

The HTML files stay shared. The page reads its slug from the path and calls that group's API. `GET /api/version` stays global. `run_worker_first` gains `/g/*` and `/all` and `/all/tv`, or those documents never reach the Worker.

An unknown or disabled slug is a 404. A group past `uploads_close` refuses new files and still serves its TV.

## Master fold

The master API loads resolved lights from enabled groups and folds them before `toPublic`. The person id is the fold key. It is not added to the public payload.

For one person id:

- Ordinances are the union of every group's list.
- Month and completion day are the earliest stored values.
- Place, coordinates, and country come from the oldest resolved row (smallest `created`).
- Public `created` is the earliest `created`, so a second group uploading the same person does not look like a new light.
- Public `updated` is the latest `updated`, so a new ordinance still refreshes the master TV.

Someone who is only queued is omitted, matching today's map. Someone resolved in one group and still queued in another is shown once, from the resolved row.

The TV identifies a light by created time, coordinates, and place. Keeping those three stable across the fold means the master screen updates a candle in place instead of adding a second one.

Master stats use the folded list, then the same tally as a group TV:

- Ancestors are distinct person ids with a resolved light.
- Each ordinance counts once per person, even if two groups both recorded a baptism.
- A baptism in one group and an endowment in another count as one ancestor and both ordinances.
- Countries are the countries on the folded lights.
- Sharers are distinct hashes across enabled groups. That part is a decision below. Ancestor dedupe is not optional.

Resetting a group deletes only that group's rows. The master drops the ancestor when no enabled group still has them.

## Administration

Super-admin is CJ. One `SUPER_ADMIN_TOKEN` secret, sent as `Authorization: Bearer`, same shape as `RESET_TOKEN`. It is not put in a URL. An `/admin` page keeps it in `sessionStorage` for the tab. Cloudflare Access is not part of this design.

The super-admin can create a group, list groups, and disable a group. Create returns the admin link once. The token is stored only as a hash. The link puts the token in the URL hash (`/g/<slug>/admin#...`) so it is not sent to the server logs. The page strips the hash after saving it for the tab.

A group admin can reset that group, change its title, subtitle, month window, upload open and close, and PIN, and rotate the admin token. They cannot see other groups, the geocache, or the master settings. Reset still keeps the geocache.

The existing bearer `RESET_TOKEN` resets only the ward group, so the curl command in the README does not wipe a tester's map.

The group that `/` points at cannot be disabled. Disabling any other group hides it from the master and from its own URLs. There is no delete in this design.

## Geocoder

One Durable Object remains the rate limit for every group. Jobs carry `group_id`. Ward jobs are ordered ahead of other groups through 30 October 2026. After that, the queue is oldest first. A per-group pending cap of 400 sits inside the existing global caps, so a test instance cannot fill the hour before the party. Cache hits still become lights without a Nominatim call.

## Local Node

`server.js` uses the same routes and the same fold. Lights in `data/lights.json` gain `group_id`. The geocache file stays global.

## Phases

1. Schema, ward backfill, and group id on every light, job, and sharer write, including the geocoder. No new URL yet.
2. Per-group upload and TV routes. `/` and `/tv` stay the ward.
3. Master TV and master stats, with the fold above.
4. Title, subtitle, and time window.
5. Per-group admin token, PIN, and reset.
6. Super-admin create, list, and disable.
7. Queue order and the per-group pending cap.

Phase 2 must not accept a second group's upload until phase 1 writes `group_id` on the finished light. Phases 4 through 7 can land in any order after phase 2. Phase 3 is what makes the combined screen true.

## Decisions for CJ

Each item has a recommendation. Ancestor dedupe on the master is the requirement this design follows. The rest are open.

1. **Path slugs, or subdomains.** Recommend `/g/<slug>` on `temple-ordinance-map.rhionin.com`. A wildcard subdomain needs a new DNS name and a Cloudflare route. Paths do not.
2. **What `/` and `/tv` show.** Recommend they stay the ward partition, not the master. The combined screen is new. Turning the party TV into every group on 29 October would mix a tester's lights into the event without a separate display.
3. **Ward slug.** Recommend `ward`. `/g/ward` is then the same map as `/`.
4. **Master paths.** Recommend `/all` and `/all/tv`, with `/all/api/lights` and `/all/api/stats`. `all` is a reserved slug, not a group that owns rows.
5. **Conflicting copies of one person.** Recommend the union of ordinances, the earliest month, and the place and coordinates from the oldest resolved row. The person id stays on the server.
6. **Disabled groups on the master.** Recommend they are left out. Their rows remain stored.
7. **Who can open the master.** Recommend an unlisted URL with no extra login, not linked from a group's phone page. Anyone with `/all/tv` can see every enabled group's places. That is wider than a single group link.
8. **Master sharer total.** Recommend distinct hashes across enabled groups, so one browser that uploaded to two groups counts once. Ancestors are already distinct person ids.
9. **Time window.** Recommend a per-group `months` (ward stays 12) and optional upload open and close. The TV keeps showing lights after uploads close. The master does not apply a second cutoff.
10. **Theme.** Recommend a title and a subtitle only.
11. **In-room PIN and remote admin.** Recommend both. The ward PIN stays `1337`. The admin token is hashed and shown once in the URL hash. The PIN is the control in the room. The token is the control from somewhere else.
12. **Super-admin login.** Recommend one `SUPER_ADMIN_TOKEN` secret. Cloudflare Access is the right tool if strangers can create groups. CJ creating a handful of groups does not need it.
13. **Who can upload.** Recommend anyone with that group's link. Slugs are chosen by the super-admin, not by the public. No upload passphrase.
14. **Disable or delete.** Recommend disable only. Refuse to disable the group bound to `/`.
15. **Geocode order.** Recommend ward jobs first through 30 October 2026, then oldest first. Per-group pending cap of 400. One pacer. Shared geocache.
16. **Existing `RESET_TOKEN`.** Recommend it clears only the ward group.
