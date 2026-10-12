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
| Super-admin | `/admin` | PIN `1337`, then list, disable, or soft-delete any group |

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
- Sharers are distinct hashes across groups that are not disabled, including soft-deleted groups.

Owner delete and super-admin delete are the same soft delete. The share page, the group map, and the admin page are gone, and the group no longer counts toward 50. Its light rows stay. Those lights still count on `/` unless the group is also disabled.

Disable is separate. A disabled group is left off `/` and its public pages are a 404. The rows stay. Super-admin can enable it again. A disabled group still counts toward 50 until it is soft-deleted.

`/` is public. Every group that is not disabled puts its places on the front page, including a group that was soft-deleted. Disable is how a group leaves that page. The group map at `/g/<slug>/map` is the partition for a group that is still public.

## Groups and the admin link

A `groups` row holds `slug`, `title`, `subtitle`, `months` (default 12), optional `uploads_open` and `uploads_close`, `admin_token_hash`, `disabled`, and `deleted`. Title and subtitle are plain text, cleaned like place names. No custom CSS and no images.

The in-room reset control on the map goes away. The owner secret is the admin link. PIN `1337` is only the gate on `/admin`.

`POST /api/groups` creates a group. The response shows the admin token once. Only a hash is stored. The link is `/g/<slug>/admin#...`. The page copies the token into `sessionStorage` and strips the hash so it is not sent on the next request.

With that token the owner can change title, subtitle, and the time window, reset the group's lights, jobs, and sharer hashes, rotate the token, or soft-delete the group. Reset removes that group's lights, jobs, and sharer hashes. Soft delete does not. Both leave the geocache. The owner cannot see other groups. After a soft delete the admin link stops working.

Creation is refused when 50 groups already exist that are not soft-deleted. Disabled groups count toward 50. Soft delete frees a slot. A global limit of 10 successful creates per hour sits in front of that cap, so one shared network address cannot lock the room and a script cannot fill all 50 at once.

Uploads to a group stay open to anyone with `/g/<slug>`. The slug is not a secret. The admin token is the secret. Optional upload open and close refuse new files and leave `/g/<slug>/map` up. The master does not apply a second date cutoff.

## Super-admin

`/admin` asks for PIN `1337`. That pin is hard-coded. It is there to turn away a curious visitor, not to stand in for an account. There is no `SUPER_ADMIN_TOKEN`. The pin is not put in a URL. Cloudflare Access is not part of this design.

The super-admin can list, disable, enable, and soft-delete any group. Create stays self-service. Disable hides the group from `/` and from its public URLs. Rows stay. Soft delete hides the group and frees a cap slot, and the lights stay on `/` until the group is also disabled. The geocache stays.

`RESET_TOKEN` no longer clears data. A group's admin link resets or soft-deletes that group. PIN `1337` only opens `/admin`.

## Geocoder

Jobs carry `group_id`. The queue is oldest first. No group is preferred. A per-group pending cap of 400 sits inside the existing global caps. Cache hits still become that group's lights without a Nominatim call.

## Local Node

`server.js` uses the same paths and the same fold. Lights in `data/lights.json` gain `group_id`. The geocache file stays global.

## Phases

1. [Fresh schema and group id on every light, job, and sharer write](https://github.com/Rhionin/Temple-Ordinance-Map/issues/50), including the geocoder. No backfill. No production migration until that pull request is merged.
2. [Share page and group map routes](https://github.com/Rhionin/Temple-Ordinance-Map/issues/51). Retire `/tv`.
3. [Master map at `/`](https://github.com/Rhionin/Temple-Ordinance-Map/issues/52), with the fold above.
4. [Title, subtitle, and time window](https://github.com/Rhionin/Temple-Ordinance-Map/issues/53).
5. [Self-service create, admin link, reset, and soft delete](https://github.com/Rhionin/Temple-Ordinance-Map/issues/54). Cap of 50 and the create rate limit. Soft delete hides the group and frees a slot. Lights stay on `/`.
6. [Super-admin list, disable, and soft delete](https://github.com/Rhionin/Temple-Ordinance-Map/issues/55). `/admin` is gated by PIN `1337`. Disable is what removes a group from `/`.
7. [Oldest-first queue and the per-group pending cap](https://github.com/Rhionin/Temple-Ordinance-Map/issues/56).

Phase 2 must not accept an upload until phase 1 writes `group_id` on the finished light. `/` becomes the master map in phase 3. There is no period where `/` must keep serving today's upload page.

## Decisions

CJ approved the defaults below, with two changes. Soft delete hides the group and frees a cap slot, and the lights stay on `/`. `/admin` uses hard-coded PIN `1337` and there is no `SUPER_ADMIN_TOKEN`.

1. **Group map path.** `/g/<slug>` is the share page and `/g/<slug>/map` is that group's map. `/` is the master map. `/new` is where someone starts a group, so the root screen stays a map.
2. **Two copies of one person.** Union the ordinances, keep the earliest month, and take the place and coordinates from the oldest resolved row. The person id stays on the server.
3. **Disabled groups.** Leave them off `/`. Keep the rows. Super-admin can enable them again. They still count toward 50 until soft-deleted. Soft-deleted groups do not count toward 50, and their lights stay on `/` until the group is disabled.
4. **Create rate limit.** 10 successful creates per hour for the whole site, plus the hard cap of 50. Not per IP. Phones at one event share a network address.
5. **Sharers on `/`.** Distinct hashes across groups that are not disabled. A soft-deleted group still counts.
6. **Time window.** Per-group `months`, default 12, plus optional upload open and close. The group map stays up after uploads close.
7. **Theme.** Title and subtitle only.
8. **Slug.** The creator picks it. First one to claim it keeps it. Reserved names are rejected.
9. **`RESET_TOKEN`.** Retire it. The admin link resets or soft-deletes one group. PIN `1337` only opens `/admin`.
10. **Geocode order.** Oldest job first. No group jumps the queue. Per-group pending cap of 400, inside the existing global caps. Shared geocache. One pacer.
