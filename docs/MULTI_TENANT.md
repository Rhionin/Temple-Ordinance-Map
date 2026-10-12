# Multi-tenant map

One Worker, one D1 database, and one Nominatim pacer. Anyone can start a group. Each group has a share page and a map of only its own lights. `/` is the master map: every enabled group, folded so one ancestor shared by two groups counts once.

The rows and links on the live site today are throwaway test data. There is no ward backfill and no promise that `/` or `/tv` keep their current meaning. Do not run a migration, a reset, or a deploy of this design until an implementation pull request is merged. Merging that pull request is what applies D1 migrations, because GitHub Actions deploys on push to `main`.

This document is design only.

## Routes

Names say what the screen shows. Nothing is named `/tv`.

| Screen | Path | Data |
| --- | --- | --- |
| Master map, every enabled group | `/` | `GET /api/lights`, `GET /api/stats` |
| Start a group | `/new` | `POST /api/groups` |
| Group share page (upload) | `/g/<slug>` | `POST /g/<slug>/api/upload` |
| That group's map | `/g/<slug>/map` | `GET /g/<slug>/api/lights`, `GET /g/<slug>/api/stats` |
| Group owner | `/g/<slug>/admin` | settings, reset, delete |
| Super-admin | `/admin` | list, disable, delete any group |

`/new` is a separate page so the master map stays a map. The creator chooses a slug. Reserved names: `new`, `g`, `map`, `api`, `admin`, `vendor`, `tv`.

There is no `/tv`, no `/all`, and no `/map` at the root. Old links are not redirected.

`run_worker_first` must include `/`, `/new`, `/admin`, `/g/*`, and `/api/*`. `GET /api/version` stays global.

An unknown slug is a 404. A disabled group is a 404 on the share page and the group map, and it is left off `/`.

## Lights belong to a group

`lights` and `jobs` use primary key `(group_id, person_id)`. `sharers` uses `(group_id, id_hash)`. The same FamilySearch person in two groups is two rows. Each group's map and stats count that person. The master counts them once.

The geocache has no `group_id`. A place resolved for one group is a cache hit for the others. One Durable Object still paces Nominatim for everyone.

The geocoder stores `group_id` on the job and writes the finished light into that group. Group upload must not ship before that write exists.

The implementation migration may drop today's lights, jobs, and sharers and create the new tables empty. It does not copy the live rows. A test builds the fresh schema and checks the keys. It does not require the old rows to survive. Nobody runs that migration against production until the implementation pull request is merged.

## Master fold

`/` loads resolved lights from enabled groups and folds them before `toPublic`. The person id is the fold key. It is not added to the public payload.

For one person id:

- Ordinances are the union of every group's list.
- Month and completion day are the earliest stored values.
- Place, coordinates, and country come from the oldest resolved row.
- Public `created` is the earliest `created`, so a second group does not draw a second candle.
- Public `updated` is the latest `updated`, so a new ordinance still refreshes `/`.

A person who is only queued is omitted. A person resolved in one group and still queued in another is shown once. The map identifies a candle by created time, coordinates, and place, so those three stay stable across the fold.

Master stats use the folded list:

- Ancestors are distinct person ids with a resolved light.
- Each ordinance counts once per person. A baptism in one group and an endowment in another are one ancestor and both ordinances.
- Countries are the countries on the folded lights.
- Sharers are distinct hashes across enabled groups.

Deleting a group deletes only that group's rows. The master drops the ancestor when no enabled group still has them.

`/` is public. Every enabled group's places are on the front page. Disable is how a group leaves that page. The group map at `/g/<slug>/map` remains the partition that shows only that group.

## Groups and the admin link

A `groups` row holds `slug`, `title`, `subtitle`, `months` (default 12), optional `uploads_open` and `uploads_close`, `admin_token_hash`, and `disabled`. Title and subtitle are plain text, cleaned like place names. No custom CSS and no images.

There is no PIN and no `1337`. The in-room reset control goes away. The owner secret is the admin link.

`POST /api/groups` creates a group. The response shows the admin token once. Only a hash is stored. The link is `/g/<slug>/admin#...`. The page copies the token into `sessionStorage` and strips the hash so it is not sent on the next request.

With that token the owner can change title, subtitle, and the time window, reset the group's lights, jobs, and sharer hashes, rotate the token, or delete the group. Reset and delete keep the geocache. The owner cannot see other groups.

Creation is refused when 50 groups already exist. Disabled groups count toward 50. Delete frees a slot. A global limit of 10 successful creates per hour sits in front of that cap, so one shared network address cannot lock the room and a script cannot fill all 50 at once.

Uploads to a group stay open to anyone with `/g/<slug>`. The slug is not a secret. The admin token is the secret. Optional upload open and close refuse new files and leave `/g/<slug>/map` up. The master does not apply a second date cutoff.

## Super-admin

CJ uses `SUPER_ADMIN_TOKEN` as `Authorization: Bearer` on `/admin`. The token is not put in a URL. Cloudflare Access is not part of this design.

The super-admin can list, disable, enable, and delete any group. Create stays self-service. Disable hides the group from `/` and from its public URLs. Rows stay until delete. Delete removes that group's lights, jobs, sharers, and group row. The geocache stays.

`RESET_TOKEN` no longer clears data. The group admin link and the super-admin token replace it and the PIN.

## Geocoder

Jobs carry `group_id`. The queue is oldest first. No group is preferred. A per-group pending cap of 400 sits inside the existing global caps. Cache hits still become that group's lights without a Nominatim call.

## Local Node

`server.js` uses the same paths and the same fold. Lights in `data/lights.json` gain `group_id`. The geocache file stays global.

## Phases

1. [Fresh schema and group id on every light, job, and sharer write](https://github.com/Rhionin/Temple-Ordinance-Map/issues/50), including the geocoder. No backfill. No production migration until that pull request is merged.
2. [Share page and group map routes](https://github.com/Rhionin/Temple-Ordinance-Map/issues/51). Retire `/tv`.
3. [Master map at `/`](https://github.com/Rhionin/Temple-Ordinance-Map/issues/52), with the fold above.
4. [Title, subtitle, and time window](https://github.com/Rhionin/Temple-Ordinance-Map/issues/53).
5. [Self-service create, admin link, reset, and delete](https://github.com/Rhionin/Temple-Ordinance-Map/issues/54). Cap of 50 and the create rate limit.
6. [Super-admin list, disable, and delete](https://github.com/Rhionin/Temple-Ordinance-Map/issues/55).
7. [Oldest-first queue and the per-group pending cap](https://github.com/Rhionin/Temple-Ordinance-Map/issues/56).

Phase 2 must not accept an upload until phase 1 writes `group_id` on the finished light. `/` becomes the master map in phase 3. There is no period where `/` must keep serving today's upload page.

## Decisions still open

CJ already settled these, and this doc follows them. Existing data and links are throwaway. `/` is the master map. Routes are named for what they show. Anyone can create, edit, and delete their own group with a one-time admin link. At most 50 groups. No accounts. No PIN. Super-admin can list, disable, and delete any group.

These still need a yes or a change. Each line is the recommendation.

1. **Group map path.** `/g/<slug>` is the share page and `/g/<slug>/map` is that group's map. `/` is the master map. `/new` is where someone starts a group, so the root screen stays a map.
2. **Two copies of one person.** Union the ordinances, keep the earliest month, and take the place and coordinates from the oldest resolved row. The person id stays on the server.
3. **Disabled groups.** Leave them off `/`. Keep the rows. Super-admin can enable them again. They still count toward 50 until deleted.
4. **Create rate limit.** 10 successful creates per hour for the whole site, plus the hard cap of 50. Not per IP. Phones at one event share a network address.
5. **Sharers on `/`.** Distinct hashes across enabled groups.
6. **Time window.** Per-group `months`, default 12, plus optional upload open and close. The group map stays up after uploads close.
7. **Theme.** Title and subtitle only.
8. **Slug.** The creator picks it. First one to claim it keeps it. Reserved names are rejected.
9. **`RESET_TOKEN` and the PIN.** Retire both. The admin link and `SUPER_ADMIN_TOKEN` are the only ways to reset or delete.
10. **Geocode order.** Oldest job first. No group jumps the queue. Per-group pending cap of 400, inside the existing global caps. Shared geocache. One pacer.
