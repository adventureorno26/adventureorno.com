# AdventureOrNo — what this is, and what is left to build

**This is the only planning document.** If a plan is not written here, it is not the plan.
Every competing one was DELETED on 2026-08-11 — `README.md`, `docs/archive/`, `docs/adr/`,
CLAUDE.md's backlog ledger, `NewClaude.md`, `CLAUDE-CODE-INSTRUCTIONS-2-70.md` — and they
are recoverable from git history if a decision needs looking up. Do not recreate them:
plans go HERE.

Last updated: 2026-08-10.

---

## 1. What the app is

A private map of everywhere Erica and Josh have been, built automatically from photos,
phone location and Strava — so that **going somewhere is enough to have it recorded**.
No data entry as the price of admission.

It answers one question well: *where have we been, when, together or apart, and what did
it look like.*

It is invite-only, has no public pages, and it is the prototype for a commercial
multi-tenant product ("Spaces").

---

## 2. The one model

Every screen should express the same shape:

> **Place → Visits → The day**

- A **place** is somewhere you went. It **counts once**, however many times you go.
- A **container** is a place that holds other places: a trail, a trip, a city, a region.
  The Appalachian Trail holds Maryland Heights and Bear's Den. A container appears
  **once** and lists each **section once**.
- A **visit** is one date at a place. Visits **count every time**.
- **The day** is what actually happened: photos, the activity, the route, the note, who
  was there.

**Opening a container gives its sections. Opening a section gives its dates. Opening a
date gives the card.** That is the design — the Sections area Erica already likes — and
it applies to trails, trips, cities and regions alike, not just trails.

Attribution (just me / just Josh / both) lives on the **visit**, never on the place: the
same place can be solo one time and shared the next.

### The rule the ingest rebuild exists to enforce

> **A machine may only propose. A person's decision writes, and it is permanent.**

Two corollaries:
- **An edit in the app IS an approval.** Never ask her to confirm the same thing twice.
- **"No suggestion" means leave it alone.** Never blank a value because the machine had
  nothing to offer.

---

## 3. What you can do — ONE place

The page formerly called Inbox is renamed **Edit**, and it absorbs every kind of data
work:

| Function | What it means |
|---|---|
| **Add** | a place, a visit, an activity, by hand |
| **Import** | Google Photos (guess the location from the photo's own coordinates, then let her correct it), file upload, Strava, the phone |
| **Ingest** | what arrives automatically — proposed for approval, never written as fact |
| **Sort** | photos into places and visits, with the location editable **right there** |
| **Edit** | names, locations, dates, who was there, categories, ratings |
| **Organize** | sections into trails, places into trips and cities, merges |
| **Delete** | with undo |
| **Fix** | duplicates, unnamed, unplaced — anything needing attention |

`/photos/sort`, `/attention` and the Settings → Data grid **fold into Edit and stop
existing separately**. `/places/edit` survives **only** as the bulk spreadsheet, because
editing 149 rows at once is a genuinely different job.

Nothing gets added *beside* this page. Things get removed *into* it.

### Interface rules (hers, non-negotiable)

- **No icons.** Text controls only. Emoji reactions on photos are the one exception.
- **Every map marker is a photo.**
- Evidence on the face of a card — "underfoot at 7 of 9 route points". A suggestion you
  cannot check is just another guess.
- **Transient UI must be transient**: the upload box and "finish importing your Google
  Photos" disappear when they are done.
- One door per action. Not three ways to Add.
- Batch changes and deploy once. No rapid deploys.
- Her recorded distances are the truth. Strava and AllTrails may never overwrite them.

---

## 4. Where the build actually is

### Live and working
- Map, places, visits, photos, videos, activities, trips-as-marked-visits, bucket list,
  timeline, stats with per-person attribution, races, peaks, elevation, weather.
- Strava, file import, phone ingest, Google Photos import.
- **The ingest rebuild, all 8 steps**: the `suggestions` / `approved_fields` ledger,
  `may_autowrite`, the route scorer (OpenStreetMap, measured against 13 real routes),
  the review page, the guard on every machine writer, learned naming rules, photo
  suggestions, and OSM attribution.
- Offline mode (service worker, network-first HTML, immutable assets cached).
- The authz matrix, and anon holding no table grants.
- Accessibility: zero WCAG A/AA violations across the authed routes, nothing allowlisted.

### Broken or wrong right now
1. ~~**The map is blank.**~~ FIXED 2026-08-10, and it was TWO faults stacked:
   - MapTiler suspended the account for exceeding quota (the idle auto-rotate had no
     stop condition; now bounded to 45s and never while hidden). The basemap is now
     **Mapbox raster tiles** — the OpenStreetMap/Mapbox look Erica asked for — with a
     30k/day tile meter, because through MapLibre Mapbox bills per TILE not per load.
   - **MapLibre 6 broke every worker-backed source.** Vector tiles, GeoJSON sources,
     clusters, routes and fog all silently rendered NOTHING — no error, no console
     message. Reproduced with a one-point GeoJSON source. Reverted to MapLibre 5,
     which CLAUDE.md pins as the stack anyway. Do not upgrade to 6 without checking a
     GeoJSON layer actually draws.
2. ~~**Containers are invisible in Places**~~ — fixed 2026-08-10. Places now lists each
   container once, holding its sections; `lib/containers.ts` decides what a container is,
   under test.
3. ~~**Sections repeat.**~~ — fixed 2026-08-10. Each section is listed once and opens to
   its dates.
4. **Data work is scattered** across six screens with different words for the same thing.
5. ~~**Three doors to Add**~~ — fixed 2026-08-10: `/add` is the one door.
6. **Transient UI is not transient** (upload box, "finish importing").
7. **Sorting photos cannot edit the location** — removed 2026-07-26, see §7.

---

## 5. The plan

Each phase ends the same way: **it works when Erica drives it**, a test that fails if it
regresses, an entry in `decisions.md`, and this file updated. Not "deployed and probably
fine."

**The verification rule (see CLAUDE.md):** every change is opened in the app, on
production, after it deploys. Done means seen on the screen. When the database and the
screen disagree, the screen is right.

### Phase 0 — One source of truth ✅ (2026-08-10)
This file. Every other planning document was archived, then DELETED (2026-08-11). The "removed on
purpose" register in §7 exists so nothing is silently lost again.
### Phase 1 — Make erasure impossible  *(audited 2026-08-11: NOT done)*
- ✅ **The build FAILS when a required `VITE_*` is empty** (2026-08-11). A Vite plugin,
  `requireClientEnv` in `app/vite.config.ts`, refuses to build without the Supabase URL
  and key, or without at least one map source. Proven by blanking each and watching the
  build exit 1. `scripts/check-env-example.mjs` still only checks DOCUMENTATION — the two
  together now cover both halves.
- **Cloudflare Pages holds no environment variables** (verified via the API). Corrected
  2026-08-11: this is NOT currently dangerous, because the live project
  (`adventureorno`, which serves adventureorno.com) is **direct-upload only** — it has no
  git source and no build command, so Cloudflare never builds it. Every deploy is a
  bundle built here with `.env.local` supplying the values.
- **There is a SECOND Pages project, `adventureorno-com`, connected to GitHub with an
  empty build command.** It serves only `adventureorno-com.pages.dev`. It is a leftover,
  and it already causes confusion: the "Cloudflare Pages" check on every PR points at it,
  not at the project that actually serves the site. Decide whether to delete it.
- ✅ **Deploys go through CI on green — on CLOUDFLARE, not GitHub Actions** (2026-08-11).
  Erica is not upgrading the GitHub plan, so the gate moved to Cloudflare Pages, which
  builds from git on its free tier. The build command is
  `npm ci && npm run lint && npm run test && npm run build`, so **a failing test or a
  lint error fails the deployment**. Verified on a real build: eslint + prettier, 88 app
  tests, 20 worker tests, then the Vite build — and the bundle it produced is
  byte-identical to the hand-deployed one.
  Cloudflare now holds every `VITE_*` (set 2026-08-11, production and preview) plus
  `NODE_VERSION=22`, so its builds are not blank.
  **Remaining:** the custom domain still points at the OLD direct-upload project
  (`adventureorno`), so this pipeline currently publishes only to
  `adventureorno-com.pages.dev`. Moving the domain makes it the real deploy path —
  it is outward-facing, so it needs Erica's word first.
  GitHub Actions stays for the heavy suite when minutes allow; it is no longer the gate.
- An acceptance list for the things she cares about, as tests that fail loudly.

### Phase 2 — Make the model show through ✅ (2026-08-10)
(see above)

### Phase 3 — The one page  *(not started)*
Inbox → **Edit**, absorbing add / import / ingest / sort / edit / organize / delete / fix
per §3. `/add` is the door; these still exist as separate surfaces and must fold into it
and then be REMOVED: `/attention`, `/photos/sort`, `/duplicates`, `/health`, `/trash`,
and the Settings → Data grid. Plus:
- **Inline location editing while sorting photos** — restore `PlaceQuickEdit` (§7,
  commit `5bb5b6e`). She asked for it back.
- **Transient UI that disappears** when it is done (the upload box, the "finish importing
  your Google Photos" banner).

### Phase 4 — A map we own  *(THE GOAL. Mapbox is a stopgap, not the destination)*
The point is **not to be limited by somebody else's charges, and not to be switchable-off
by somebody else**. MapTiler proved the second half by suspending the account and taking
every map in the app with it.

**Worth knowing: Snapchat does not do this.** Snap Map runs on **Mapbox** (partnership
since 2017 — Mapbox Outdoors vector data plus Mapbox Satellite, OpenStreetMap
underneath). The look Erica likes IS Mapbox+OSM; Snap simply pays Mapbox at enterprise
scale. Self-hosting is the opposite trade, and it is available to us because Protomaps
publishes the same OpenStreetMap planet as a single file.

**Decided 2026-08-11: the WHOLE PLANET, full detail.**

| | |
|---|---|
| File | `build.protomaps.com/<date>.pmtiles` — daily OSM planet build, zoom 0–15 |
| Size | **137.3 GB** (2026-08-10 build), verified by content-length |
| Verified | HTTP 206 range requests, `PMTiles` spec v3, `accept-ranges: bytes`, served from Cloudflare |

**Cost, in R2 — flat, and the whole reason for doing it:**

| Line | Amount |
|---|---|
| Storage 137.3 GB × $0.015/GB-month, minus the 10 GB free tier | **≈ $1.91 / month** |
| Class A (writes): ~1,400 multipart parts, one-time | free (1M/month included) |
| Class B (reads): 1 per tile served; two people browsing | free (10M/month included) |
| **Egress** | **$0 — R2 never charges for it** |
| **Total** | **≈ $2 / month, flat, no matter how much we look at it** |

Against that, Mapbox through MapLibre bills **per tile request**, which is precisely the
shape of the blowout that cost us MapTiler.

**Getting 137 GB in without touching Erica's Mac.** The planet file is served *from
Cloudflare*, and R2 is *in* Cloudflare, so the copy never leaves their network: a Worker
reads ranges from the source and writes them to R2 as a multipart upload (~1,400 × 100 MB
parts), driven until it completes. No 137 GB download, no 137 GB upload, no overnight
saturation of her connection.

**Steps**
1. **Erica: create an API token with R2 read+write.** The only blocking human step — none
   of the tokens in `.env.local` can touch R2 today (the photo Worker reaches R2 through a
   binding, not the API). Cloudflare dashboard → My Profile → API Tokens.
2. Bucket `aon-basemap`; copier Worker; run the copy.
3. A tiles Worker serving `/basemap/{z}/{x}/{y}` out of the pmtiles, with edge caching so
   repeat views cost nothing, plus the same budget meter.
4. Self-host the **glyphs** (fonts) and any sprite in the same bucket, or the map still
   calls a third party for its lettering.
5. **The style, authored in the app's own colours** — this is the other half of the point,
   and it is what fixes Erica's "I don't like the colour": the Mapbox basemap is neutral
   grey and does not match the cards. Built against the real tokens:
   `--bg #060a14`, `--bg-2 #0a1122`, `--panel #0e1728`, `--panel-2 #131f36`,
   `--border #1f2d4d`, `--text #eaf1ff`, `--muted #93a6cc`, `--accent #3b82f6`.
6. Cut MapLibre over; Mapbox drops to **failover only**; the meter stays.
7. Verify live, per the rule.

**Still third-party afterwards, and worth naming:** search/geocoding (Mapbox Search Box)
and weather (Open-Meteo). Self-hosting search is a separate decision — Nominatim/Photon
are the options.

### Phase 5 — Commercial readiness  *(not started; deliberately last)*
Multi-tenant Spaces, per-tenant quotas, branding, install flows. Two constraints already
established and not negotiable by wishing:
- **Google Photos can no longer answer "photos from that day."** The library scopes were
  removed in March 2025; the Picker returns no GPS and cannot search by date or location.
  Date-based photo suggestion needs the phone, not Google.
- **Strava forbids showing Josh's data to Erica** in the same application. Josh has given
  personal approval, which settles it between them; it does not change Strava's terms for
  a commercial product. The route through it is bulk export as user-owned records — 265
  of 445 activities already arrived that way.

### Smaller things the 2026-08-10/11 work turned up
- The people markers collide with a place cluster when someone is standing on one.
- **Josh's last-seen is 30 hours old** because a web app gets no background location on
  iOS. Giving him the same iOS Shortcut ingest Erica has would make "where we are" real.
- **MapLibre 6 is blocked** (§8) until a GeoJSON layer is proven to draw on it.

## 6. Why work kept getting erased — and what now prevents it

Five mechanisms, all evidenced:

| Mechanism | Fix |
|---|---|
| Six competing "what to do next" documents (~380 KB across ~40 files) | This file, and only this file |
| Removals not recorded as reversible | The register in §7 |
| Hand-deploys bypassing CI | Phase 1 |
| Model rules leaking across layers (`holds_children` → invisible) | Phase 2, plus a test |
| Config vanishing silently (`VITE_GOOGLE_CLIENT_ID`) | Phase 1 build assertion |

---

## 7. Removed on purpose — the register

Anything deliberately removed goes here, with the commit, so it is never mistaken for
lost work and can be restored in minutes.

| What | When | Why | Restore from |
|---|---|---|---|
| Address/place editing in the photo sorter (`PlaceQuickEdit`) | 2026-07-26 | She asked for "JUST THE VISIT INFORMATION" — place-level fields were confusing inside a visit-sorting flow | commit `5bb5b6e`; the component still exists, unused. **She now wants it back (Phase 3).** |
| The `trips` and `trip_stops` tables | 2026-08-08 | A trip is a visit you marked, not a separate object | commit `aa6e553` |
| The 5-step Add wizard | 2026-08-08 | Replaced by one add sheet | commit `fd3004d` |
| Service-worker registration | earlier | A cached shell served stale code | restored 2026-08-10 with HTML network-first |
| `apply_naming_rule(uuid)` (geofence-only) | 2026-08-10 | It could rename 76 activities on start-point alone | migration `0152` |
| "downtown Leesburg, VA" as an Appalachian Trail section | 2026-08-10 | Not on the AT. **The place itself was kept** — it holds 3 photos and 2 visits | migration `0155` (the earlier membership-row delete did not take: `part_of` is the record and its trigger rebuilds membership) |

---

## 8. Facts that must not be relearned

- **Overpass** rate-limits 2 slots per IP and edge functions share Supabase egress:
  rotate mirrors, hard-abort at 25s, keep batches ≤8.
- **Overpass returns nothing for Red Rock / Lake of the Red Rocks** — 97 activities. No
  suggestion must mean leave it alone.
- **`admin.rpc(...).catch()` is a TypeError** — an rpc() is a thenable, not a Promise.
- **A date-only string parses as UTC midnight** and renders as the previous day west of
  Greenwich. Parse `YYYY-MM-DD` with local components. (`fmtRunDate` now does this itself.)
- **`places.part_of` is the record of membership; `place_membership` is a copy.** A
  trigger rebuilds the table from the array on every update of that place, so deleting a
  membership row alone does nothing and undoes itself. Write `part_of`.
- **The app's global input CSS is `display:block; width:100%`** — it makes a radio 238px
  wide. Pin size on any radio or checkbox.
- **MapLibre 6** removed the default export; **Vite 8** removed object `manualChunks` and
  preloads lazy chunks (both put 1 MB of MapLibre back on `/login`).
- **A branch deploy goes to a preview alias**, not production; the alias serves a stale
  `index.html` for a while — verify against the exact deploy-hash URL.
- **`AON_SUPABASE_SECRET_KEY` in `.env.local` is the disabled legacy JWT.** Use
  `SUPABASE_SECRET_KEY`.
- **No local Deno, no psql.** Edge-function pure logic is tested by vitest; SQL tests run
  against production inside a rolled-back transaction — which is **not** equivalent to a
  fresh database, so tests must never assert production row counts.
- **Never** reintroduce the home exclusion zone. **Never** force-push. The service_role
  key is already rotated — do not ask her to rotate it again.

---

## 9. Where things live

- **Model reference:** `docs/SCHEMA.md`
- **Decision history (append-only):** `docs/decisions.md`
- **Agent instructions and business rules:** `CLAUDE.md`
- **Operations:** `docs/MANUAL-SETUP.md`, `docs/backup-restore.md`,
  `docs/deploy-cloudflare.md`, `docs/deploy-photo-gateway.md`, `docs/ios-shortcut-*.md`
- **History:** git. `git log --diff-filter=D --name-only` finds the deleted plans.

Both of those lived outside the repo and are now deleted too.
