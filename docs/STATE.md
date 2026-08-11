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

### Marking something done (her rule, 2026-08-11)

> **This file is updated ONLY after the change is verified live on the app.** Not when the
> code is written, not when it is committed, not when it is deployed — when it has been
> opened on the real site and seen working.

Plans may be written here in advance. **Status** may not: ✅ means seen on the screen.

### How a new direction gets handled (her rule, 2026-08-11)

> **If a new direction conflicts with this file, say so before acting.** Name the change
> it would make, ask whether that is what she wants, and only then write the decision
> here. Do not silently follow the newer instruction, and do not silently follow the
> older document.

This is not a licence to stop and ask about everything: it applies when a direction
CONTRADICTS something written here. Otherwise keep working (see
[[adventureorno-autonomy]] — she leaves for hours and expects progress).

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
4b. ~~**THE BIGGEST CONFLICT IN THE REPO: the machine writes visits.**~~ **FIXED
   2026-08-11, migration `0157`.** A person's decision is now permanent by
   CONSTRUCTION, not by remembering a flag: a trigger marks a visit decided whenever a
   signed-in person changes it (`auth.uid()` is null for every machine job, so the
   discriminator is free), pinning a photo marks its visit decided, the rebuild will not
   delete a visit that holds pinned photos, and a pinned photo no longer seeds a day of
   its own. Proven by replaying the destructive case in a rolled-back transaction: an
   unprotected visit holding a pinned photo survived with its photo attached. The
   original diagnosis is kept below because the SHAPE of it will recur.
   ORIGINAL: the machine writes visits.
   `rebuild_place_visits()` DERIVES visits from photo dates, ping dates, activity dates
   and entry dates, and **writes them as fact** — and deletes and recreates them on the
   next run unless `manual = true`. **476 of 488 visits are machine-derived; only 12 are
   protected.** That is the exact opposite of §2's rule, *a machine may only propose*.
   It is also the cause of the Virginia Beach complaint (2026-08-11): the race was
   **22 Mar**, but photos dated 3 Mar, 4 Mar and 20 Jul each produced their own visit, so
   the place reads as three. **34 of 176 photos carry a taken_at of exactly 12:00:00** — a
   placeholder, not real EXIF — so those dates were never trustworthy in the first place.
   §10 (the data model, below) documents the rebuild as intended behaviour, which makes this a
   conflict between the two documents, not just a bug.
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
1. ✅ **R2 access** — done 2026-08-11: Erica ran `npx wrangler login` and added
   `CLOUDFLARE_API_TOKEN_MASTER` to `.env.local`, which is verified against both R2 and
   Pages. (`CLOUDFLARE_ACCESS_TOKEN` in that file is NOT a valid API token, and the old
   `CLOUDFLARE_API_TOKEN` name is gone — the deploy docs and skill now say so.)
2. ✅ Bucket `aon-basemap` created, copier Worker deployed
   (`workers/basemap`, `adventureorno-basemap.adventureorno26.workers.dev`), **copy
   running** (started 2026-08-11 13:02 UTC). Measured on the real thing:
   - one 100 MB part takes ~37 s from the source (~2.7 MB/s), so sequential would be
     ~13.5 hours;
   - **8 parts in parallel is the ceiling** — 16 trips Cloudflare's outbound connection
     limit ("Response closed due to connection limit") — and gives ~10 MB/s, so the
     137.3 GB lands in **about 3.7 hours**, once;
   - it is resumable: the Worker keeps its state in the bucket, a failed batch records
     nothing and is simply retried, so `scripts/copy-planet.sh` can be stopped and
     restarted at any point.
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

### Open, awaiting Erica's decision (found 2026-08-11)

**A. TOGETHER, DEFINED (Erica, 2026-08-11).** Together is **a tag on a person, approved by
that person**. It is not something the app works out and applies.

- You tag someone on a place, trail, activity, photo — **anything a user can edit**.
- **They are asked to verify it before it is added.** Until they accept, it is not Together.
- If two people in the same flok were at the same place at the same time, that produces a
  **suggestion** — *"add this ___?"* — never an automatic label.
- Everyone's own imported data is **"just me"** by default.

This supersedes the earlier "automatically labelled Together" wording, and it agrees with
§2's rule: the machine proposes, the person decides. It also settles the open question
below, which was written before this instruction.

**A(i). The old problem it fixes: "Together" was claiming things you did apart.** Same disease as 4b: absence of
information rendered as a positive claim. `visits.solo_profile IS NULL` means *nobody
said*, and the UI reads it as *both of us were there*.
- **100 visits** are NULL → shown as Together. Only **5** were set by a person.
- **56 activities** are NULL → shown as Together. **46 of them already carry an
  `athlete_id`**, so we KNOW whose outing it was and simply never used it.
- Genuinely-together evidence does exist: **16 shared outings** (27 activities linked by
  `shared_group_id`, where both athletes recorded the same outing).
⚠️ **CONFLICT:** §10 (the data model, below) states `null = Both`. Fixing this changes that rule to
`null = unknown`, with Together becoming something the data has to EARN.

**B. Attaching the 156 unpinned photos.** Bucketed against the visits that already exist:
| Bucket | Count | Safe? |
|---|---|---|
| Exactly one visit at that place on that day | **122** | yes — same place, same day, no ambiguity |
| Fabricated `12:00:00` timestamp | **32** | NO — the date is not real, so it must be proposed |
| No date at all | 2 | no |
| Ambiguous (several candidate visits) | 0 | — |
Nothing is ambiguous, which is why this is worth doing: 122 can be attached with
certainty, and 0157 now makes that attachment permanent.

### PLAN: keeping the map current once we own it
*(Erica, 2026-08-11: "Create a plan to keep the map updated if things are changed.")*

Owning the basemap means owning its freshness. OpenStreetMap changes daily; the copy in R2
is a snapshot of one build. Without a refresh plan, our map silently ages while the world
moves — a new trail she walks might not exist on it.

**How it works:** Protomaps publishes a dated planet build every day
(`build.protomaps.com/YYYYMMDD.pmtiles`). A refresh is the same copy job pointed at a newer
date, into a NEW key, with a swap at the end.

1. **Never overwrite the live file.** Copy to `planet-YYYYMMDD.pmtiles`, verify it, then
   point the tile Worker at the new key and delete the old one. A half-copied basemap must
   never be able to become the live basemap.
2. **Cadence: quarterly, plus on demand.** Daily is pointless for a travel map and costs a
   137 GB copy each time. Erica asks for a refresh when somewhere she has been is wrong.
3. **Cost of a refresh:** the copy itself is free (inside Cloudflare); storage doubles for
   the hour or so both files exist — pennies. Class A writes ~1,400, well inside the free
   tier.
4. **What triggers one:** a quarterly reminder, or her saying a place is missing/wrong.
5. **Verification before the swap** (never skip): file size within ~5% of the source's
   content-length, PMTiles v3 header reads, and a handful of known tiles render — the
   Appalachian Trail, Leesburg, San Diego, Barbados.
6. **Rollback is instant** because the old file is still there until the new one is proven.

**Corrections to OSM itself** (a missing trail) are a different thing: those go upstream to
OpenStreetMap and arrive in a later build. Nothing we can patch locally without forking the
data, which we will not do.

### PLAN: a user's change can never be auto-deleted
*(Erica, 2026-08-11: "Create a plan to make sure that user changes are never auto-deleted."
Said three times now — this is the one that keeps coming back.)*

Migration `0157` fixed this for VISITS. The rule has to hold for everything she can edit.

**The principle:** a machine may write only where a person has not decided. The moment a
person decides, that field is theirs, permanently, and automation routes around it.

**Why it kept breaking:** protection depended on each writer REMEMBERING to set a flag, and
three of them did not. Nothing structural stopped a new writer from forgetting. So the fix
is never "set the flag in one more place" — it is "make it impossible to forget".

**The mechanism that works** (proven in 0157): a database trigger marks the row decided
whenever a SIGNED-IN PERSON changes it. `auth.uid()` is non-null only for a real user's
request; cron jobs and edge functions run as service_role with no uid. The discriminator is
free and cannot be forgotten, because no writer has to do anything.

**Still to extend, each needing the same treatment:**
| What she edits | Protected? | Notes |
|---|---|---|
| Visit dates, note, attribution, trip flag | ✅ 0157 | trigger + rebuild refuses to delete |
| A photo pinned to a visit | ✅ 0157 | pin marks the visit decided |
| **Place NAME** | ❌ | `name_locked` exists but the naming rules still write; verify |
| **Place dates** (first/last visit) | ❌ | derived from evidence |
| **Trail / segment membership** | ❌ | `part_of` is rewritten by merges and rules |
| **Race names and assignment** | ❌ | `assign_activity_to_race` rebuilds |
| **Activity name, type, attribution** | ❌ | learned naming rules rewrite these |
| **Categories and tags** | ❌ | `sync_place_category` trigger |
| **Cover photo, rating, review** | ❌ | probably safe; verify |

**And the Save button she asked for:** the trigger makes every save permanent
automatically, so the button is not strictly required to make it TRUE. It is required to
make it VISIBLE — she has been told twice that her work is safe and twice it was not. A
card that says *"Saved — automation will not change this"* with the date is the honest
version of the promise, and a way to hand a field back to automation if she ever wants it.

### FLOK — what the research settled (2026-08-11, two rounds: research then refutation)

**1. STRAVA CANNOT BE PART OF A PAID FLOK.** The risk recorded as UNVERIFIED is now
VERIFIED against the live policy (https://www.strava.com/legal/api_policy, effective
1 June 2026) and survived an adversarial re-check. Four clauses each independently kill it:

| Clause | What it says | What it kills |
|---|---|---|
| §5.7 | may not "aggregate, cache, or store geographic location information" | the whole map |
| §6.2 | may not retain Strava data "longer than seven (7) days" | every history we hold |
| §2.3 | data "may be displayed or disclosed … only to that user" | showing Josh's outing to Erica |
| §5.8 | "**may not charge end users, in any manner**" | charging for Flok at all |

Also: §5.10 forbids it *even with the user's consent*; §5.4 forbids aggregation/analytics;
§5.5 forbids persistent indexes; §5.3 forbids AI/ML. Access is 1 athlete by default, 10
self-serve, more only at Strava's discretion. Aggregators (Terra, Spike, Rook) were shut
out on 1 June 2026, so there is no back door.

**The escape hatch is the one already in use:** a user's own Strava EXPORT is not "data
accessible via the API", and 265 of 445 activities arrived that way. It conflicts with
Erica's "no importing files, that is a last resort" — and that tension IS the decision.

**2. The provider reality for a paid product**, after the refutation corrected the first
pass:

| Provider | Verdict |
|---|---|
| **Google Health API** (ex-Fitbit) | **The one clean win.** TCX with real GPS trackpoints. Needs OAuth verification + CASA review past 100 users; exercise pages cap at 25 items, so a decade of backfill is real engineering. Legacy Fitbit API dies Sept 2026 |
| **Garmin** | **OPEN — apply today.** ~2 business days. The first research pass said the programme was paused; that was WRONG. Business use only, and "commercial use requires a license fee payment" for some metrics |
| **Polar** | **CUT IT.** Forward-only from the moment of consent — a new user gets an empty map until their next workout. Not "90 days of history" |
| **Wahoo** | Narrow — returns only workouts recorded through Wahoo's own systems |
| **Suunto / Coros** | Approval-gated / unverifiable. Small populations |
| **Google Timeline** | No public API. Not now, not ever |
| **Apple Health** | No web API. Native app or nothing |

**3. "Within 10 feet" would break the feature.** 3.05 m is below the noise floor of consumer
GPS. Measured against real accuracy distributions it discards **~80% of genuinely-together
moments in the open, ~91% under tree cover, ~99% in a city** — worst exactly where Erica
hikes. Two more floors sit under it: polyline precision-5 quantises to ~1.1 m, and
`summary_polyline` is decimated for display, deviating tens of metres.

**The fix is to stop deciding on distance and decide on DURATION of closeness:**

| Parameter | Erica asked | Use | Why |
|---|---|---|---|
| Distance | 3 m | **60 m** | recovers ~100% open-sky and canopy. Strava's own tiles are 80 m |
| Start window | 10 min | **±30 min** | a fine filter, a terrible decision — 12 min apart then two hours together IS together |
| Overlap | — | **≥10 min AND ≥25% of the shorter activity** | below that it is a flyby, not a shared outing |
| Coverage | — | **≥60% propose, ≥80% auto** | a stranger would have to hold pace within 0.10 km/h for 90 minutes to fake 80% |
| Samples | — | **≥40 aligned** | one lucky point pair is not evidence |

Strava's shipped social grouping uses 80 m tiles and a **50%** threshold; 80% is stricter
than production. And the repo has the counterexample already: the 2026-03-07
Purcellville→Arlington run, which migration `0079`'s 800 m START-proximity rule never
caught, because the two records of the same run start in different places.

**4. One STATE.md line needs amending:** "Google Photos can no longer answer photos from
that day" is half wrong. You cannot SEARCH by date, but `createTime` comes back on every
picked item. Still no GPS.

### C — broken now, quietly (status 2026-08-11)

| | What | Status |
|---|---|---|
| C1 | The photo-gateway deploy block piped EMPTY strings over two working Worker secrets (`$SUPABASE_SERVICE_ROLE_KEY` / `$SUPABASE_ANON_KEY` do not exist in `.env.local`) | ✅ fixed in §12c — right names, and it now REFUSES to write a blank |
| C2 | `CLOUDFLARE_API_TOKEN` renamed to `…_MASTER`, but wrangler reads the un-suffixed name | ✅ fixed in §12b — mapped across, and `wrangler login` noted as the alternative |
| C4 | The tile meter counted only tiles. Mapbox **Search Box and Directions** are plain fetches billed per request and were invisible to it | ✅ **VERIFIED LIVE** on deploy `f38cc846`: typing in search moved `aon_api_budget` from nothing to 1. Four call sites metered (suggest, retrieve, forward, directions) with their own 2,000/day budget; refusing a search degrades honestly, unlike refusing a tile |
| C3 | Server-side geocoding dead since the MapTiler suspension — verified 403 on geocoding, not just tiles | ✅ **fixed, client and server.** `MAPBOX_TOKEN` is now a Supabase secret (it was absent — the app moved to Mapbox on 08-10, the functions did not). One shared `supabase/functions/_shared/geocode.ts` does Mapbox → MapTiler → nothing, and **zero `api.maptiler.com` calls remain** outside that fallback. `geocode-new-places`, `suggest`, `detect-trips`, `strava-webhook` and `strava-backfill` redeployed; all three callable ones verified BOOTING with the new module (a bad import 500s before the auth guard, and they return their own 401 instead). Client `reverseGeocode` prefers Mapbox too. **Not yet seen end-to-end**: naming a real new place needs an owner session (Erica's) or the next Strava ingest |
| C5 | The device ingest token travels as `?token=` and is therefore in Supabase's request logs in plaintext | ❌ not started. Needs header support + a change to her iPhone Shortcut |
| C6 | `ANTHROPIC_API_KEY` is set nowhere, so `ai-suggest` silently answers "not configured" | ❌ not started — needs a key, or the UI should say it is off rather than look unbuilt |

### Erica's directions, 2026-08-11 — to build
1. **Remove the redundant "+ Add" button at the top of the map.** Asked for before and
   missed. The nav already has Add; §3 says one door per action.
2. **Settings becomes the gear wheel, not a nav pill.** Account, Connections, Privacy,
   Data and Advanced all extracted onto ONE nicely styled page that opens from the gear
   (bottom-left). **No section labels** — not "Account", not "People" — it should read as
   one seamless page, not five tabs stacked.
   ⚠️ **CONFLICT, resolved with her:** §3 and the nav say FIVE tabs including Settings.
   This makes it four (Map / Places / Add / Timeline) with Settings behind the gear.
3. **Join Requests moves into the People section.**
4. **Photos must appear on the VISIT card.** Today they only do when a photo's date lines
   up, and **156 of 176 photos are not pinned to any visit**.
5. **The place card gets ONE carousel**, with the date, and the heart / fire reactions
   available there. It is currently one carousel PER VISIT, and the reactions only exist
   inside the full-screen lightbox — which is why it reads as "where did it go".

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
- **A deleted file can be RESURRECTED by OneDrive plus the auto-save commit.** `README.md`
  was deleted on 2026-08-11 and reappeared 90 minutes later in
  `auto: save from Claude Code (2026-08-11 08:58)` — OneDrive restored the file from its
  own history and the periodic auto-commit added it back. After deleting anything, check
  it is still gone an hour later.
- **Never** reintroduce the home exclusion zone. **Never** force-push. The service_role
  key is already rotated — do not ask her to rotate it again.

---

## 9. Where things live

**Here.** Everything is in this file, from 2026-08-11: the model, the business rules, the
operations runbooks, the security baseline and the decision history are all sections below.

`CLAUDE.md` still exists ONLY because Claude Code loads it automatically at the start of
every session — it is a four-line pointer to this file, not a second document. Nothing
else is a `.md`.

**History of deleted docs:** git. `git log --diff-filter=D --name-only` finds them.

Both of those lived outside the repo and are now deleted too.


---

# PART TWO — REFERENCE

Everything below was a separate markdown file until 2026-08-11. Erica: *"it is now the
SINGLE source of truth and any future changes and instructions should be added there,
never create a new MD."* The plan is Part One, above; this is the reference material it
relies on.

## 10. The data model
*(was §10 (the data model, below))*

**Authoritative as of 2026-08-08 (migrations 0136–0137). If any other document, comment, or
plan contradicts this file, this file wins and the other one is wrong.**

Read this before touching places, visits, trips, stats, or containment.

#### Why this file exists

The same schema work was redone at least five times. The cause was not carelessness —
it was that **three different models were each "authoritative" in some document**, so
every session picked one and undid the last:

| Document | Claimed a trip is… |
|---|---|
| ADR 0001 (deleted 2026-08-11, in git history) | a first-class `trips` row, **not** a place |
| `NewClaude.md` (deleted 2026-08-11) | a **place** that is a non-counting rollup |
| What Erica actually wants | a **visit she marked** |

Worse, two mechanisms silently *regenerated* the retired model, so data fixes could
not hold:

1. `sync_place_category` had `when NEW.categories @> array['trip'] then 'trip'` as its
   second branch. Migration 0127 cleared that category; every later UPDATE re-derived
   it. Cape Cod ended up back at `category='trip'` → `counts_as_place=false`, holding
   10 photos and a real visit while counting as **nothing**.
2. `visits.is_trip` was a GENERATED column, `end_date > start_date` (migration 0047),
   so the database promoted **any** multi-day visit to a trip by arithmetic. 50 of 485
   visits were flagged trips that Erica never marked. Brewster's 2-day stay was one.

Both concepts are now removed, not merely cleaned up. There is nothing to regenerate.

#### The model — two nouns

##### PLACE — counts **once**, ever

A row in `places`. Every real thing is one: a city, a region, a restaurant, a beach, a
trail, a destination like Cape Cod. Returning to a place does **not** add another
place; it adds a visit.

```
counts_as_place = NOT is_trail
```

A **trail** is the only thing that does not count, because it is a rollup of segments
that already counted — counting it too would double-count. A destination **always**
counts. There is **no `trip` place category**; do not add one back.

A city is both a place you visited *and* a box holding other places. It is not one or
the other. San Diego counts, and so do the taco shop, the beach, and the ride.

##### VISIT — counts **every** time

A row in `visits`: dates, attribution, and evidence. Two stays in San Diego are two
visits at one place.

- `is_trip` — **a person marked this visit as a trip.** Nothing automatic ever sets
  it. Not duration, not a stop count, not an importer. `set_visit_is_trip()` is the
  only way, and it requires owner/editor.
- `status` — `taken` (it happened) or `planned` (a future-dated trip).
- `manual` — protects the row from `rebuild_place_visits`, which deletes derived
  visits. Any marked trip is `manual = true` for exactly this reason.
- `solo_profile` — attribution. `null` = **Both**; otherwise that person. Attribution
  lives on the visit only, never on the place. `places.solo_profile` was the last
  place-level remnant and was **dropped in 0136**; read a place's attribution from
  `place_attribution()`, which derives it from the visits.

**Photos and activities are evidence hanging off a visit.** They are not sibling rows
and never their own visits. Brewster is one 2-day visit that contains a ride and a
run — not three visits.

#### Containment

A place attaches to a container two ways:

- **spatially** — coordinates inside a `boundary` polygon (cities, regions)
- **by explicit link** — `place_membership`, for trails and destinations

`place_membership` is canonical. `places.part_of` is the legacy array that the
membership trigger mirrors; write through `part_of`, read from `place_membership`.

#### The statistics

Every stat uses the same view rule, so they can never disagree:

```
p_profile IS NULL  ->  visits where solo_profile IS NULL          ("Both")
otherwise          ->  that person's visits PLUS the Both visits
```

| Stat | Definition |
|---|---|
| Places | distinct places with a qualifying visit, where `counts_as_place` |
| Visits | count of visit rows (the map badge = number of visits, never days) |
| Trips | count of qualifying visits where `is_trip` and `status='taken'` |
| Miles | sum of `activities.distance`, attributed the same way |

#### Naming (migrations 0129–0131)

There is **no automatic naming.** The nightly geocoder and the dupe-merger were
unscheduled in 0130 — they were the thing overwriting names within the hour.

- `name_locked` — a person named it; automation must never rewrite it
- `named_by` — who chose the name
- `name_scope` — the space it was named in: a profile id = that person's own space and
  only they may rename; `null` = the shared Both space and either may

A real name is claimed on **any** write by a trigger (0131), so the several client
creation paths cannot drift out of sync one at a time.

#### Rules for changing this

1. Never reintroduce a `trip` place category or a derived `is_trip`.
2. A one-shot data fix that a trigger can undo is not a fix. Remove the mechanism.
3. Every rule here is enforced by a DB test in `supabase/tests/`. If you change a
   rule, change its test in the same migration — and give the test a negative control
   that fails when the rule is removed.
4. Update **this** file, not a new plan document.

#### Retired — do not restore

- The `trips` / `trip_stops` tables (a trip is a visit). **Dropped in 0137**, along
  with the `trip` place category, the /trips + /trip/:id + suggested-review pages,
  and every `*_trip_stops_*` function. `rebuild_place_visits` takes its fusing
  window from `visits.is_trip` now; `create_experience` raises on a trip link.
- `places.solo_profile` (dropped in 0136).
- `places.category = 'trip'`, and `holds_children` including `'trip'`.
- `visits.is_trip` as a generated column.
- Auto-detected / `suggested` trips that reappeared as new suggestions daily.
- The nightly geocode and dupe-merge schedules.

## 11. Business rules and agent instructions
*(was the substance of `CLAUDE.md`)*

Private travel-map web app for Erica (owner) and her partner (editor). World map of visited
places, auto-built from photo EXIF, passive GPS, and Strava. Invite-only. Domain:
adventureorno.com on Cloudflare Pages. Repo: github.com/adventureorno26/adventureorno.com
(GitHub account: adventureorno26).

#### The verification rule (non-negotiable)

**Every change is verified in the UI, on production, after it deploys.** Not "the build
is green", not "the migration applied", not "the row is in the table" — opened in a
browser, on the real site, doing the thing it claims to do.

This exists because it was broken repeatedly:
- A membership row was deleted and the card still showed the section, because the UI
  reads a denormalised `part_of` column and the delete never touched it.
- 28 visits were reported as empty because a query counted activities on the container
  instead of the sections.
- A config value went missing and the Google Photos button silently disappeared —
  nothing failed, nothing logged.

So: **done means seen on the screen.** If it has not been opened in the app after
reaching production, it is not done, and it must not be reported as done. When the
database and the screen disagree, the screen is right.


#### Stack (do not substitute without asking)
- Frontend: React 18 + Vite + TypeScript. MapLibre GL JS v5 for all maps. Deployed to Cloudflare Pages.
- Basemap: MapTiler (key in env `VITE_MAPTILER_KEY`). Geocoding: MapTiler Geocoding API.
- Backend: Supabase — Postgres 15 with PostGIS, Auth, Edge Functions (Deno), pg_cron.
- Photo storage: Cloudflare R2, accessed only through the `photo-gateway` Worker (upload + signed reads).
- Workers: Wrangler-managed, in `/workers`. Edge Functions in `/supabase/functions`.
- Package manager: npm. Lint: eslint + prettier. Tests: Vitest, SQL regression tests on a disposable Supabase stack, Worker tests, and Playwright across desktop Chrome/WebKit plus iPhone/Android projects.

#### Repository layout
```
/app                 React SPA
/workers/photo-gateway   R2 upload, thumbnailing, signed URL reads
/supabase/migrations     SQL migrations (numbered, never edited after merge)
/supabase/functions      ingest-overland, strava-webhook, strava-backfill, invite
/docs                MANUAL-SETUP.md, ios-shortcuts spec, decisions log
```

#### Non-negotiable business rules
1. **No home exclusion zone.** There is NO location-based ingest filter. Photos, location pings,
   and Strava activities are stored regardless of where they were taken — including at home. (The
   old 15-mile "home zone" around Leesburg was removed in migration `0102`; do not reintroduce it
   anywhere — code, `settings`, docs, or UI.) Local outings ARE logged and counted.
2. **Strava ingest.** Every Strava activity with a start point is ingested and placed, regardless
   of type or location. (Hikes/Walks/Runs are no longer a special case — nothing is excluded.)
3. **Mileage counter.** The stats bar shows total miles (sum of `activities.distance`, meters →
   miles, 1 decimal) across all stored Strava activities, plus a per-type breakdown on hover/tap.
4. **Photo processing.** Server-side resize so the longest edge ≤ 2400 px (originals are NOT
   retained), plus a 400 px thumbnail. Serve via signed URLs only — no public R2 access. Strip
   GPS EXIF from the stored file; coordinates live only in the DB.
5. **No screenshots.** The upload Worker rejects: any image without GPS EXIF, any PNG, and any
   image whose EXIF lacks a camera make/model. (The iOS Shortcut also filters `Is Screenshot =
   false` and `Has GPS = true` — the Worker is the backstop, not the only gate.)
6. **Deletion blocks the automated re-import, but a manual re-upload can bring a photo back.**
   Owner can delete any photo; an editor can delete photos they uploaded. Deletion removes the R2
   objects and DB row AND inserts the photo's SHA-256 hash into `deleted_hashes`. The nightly
   Shortcut ingest still rejects any upload whose hash is in `deleted_hashes` (so deletions aren't
   auto-resurrected). A **deliberate manual upload** (override) may re-add a deleted photo — doing
   so clears the hash from `deleted_hashes`. (Changed from the original "permanent + sticky" rule
   at the owner's request.)
7. **Auto-upload is Erica-only.** Exactly one device ingest token exists (Erica's). The partner
   has role `editor`: full manual upload / entry editing rights in the UI, but no ingest token is
   ever issued to him, and there is no UI to create additional device tokens without owner role.
8. **Privacy.** No public routes. Every page requires an authenticated session; every table has
   RLS requiring a `profiles` row. Signups disabled in Supabase Auth — access only via the invite
   flow. Never log photo coordinates or tokens.

#### Schema quick reference

**The data model is defined in §10 (the data model, below) — read that first.**
A place counts once; a visit counts every time; a trip is a visit you marked. There is
no `trips` table and no `trip` place category.

(Table list below; authoritative version = migrations)
`places`, `entries`, `photos`, `location_pings`, `activities`, `trips`, `profiles`, `invites`,
`deleted_hashes`, `settings`, `ingest_tokens` — as defined in `0001_init.sql`. Geometry columns
are `geography(Point,4326)`. Cluster job uses `ST_ClusterDBSCAN` over unassigned photos + pings,
merge radius 10 km, assigning to nearest existing place within 10 km before creating new ones.

#### Environment (this project's live services)
- Supabase project URL: `https://aanfyhsjbtnqzphuoiem.supabase.co`
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_...` key) are
  client-safe and live in `.env.local` / Pages env vars. The **service_role key is never
  committed, printed, or logged** — Supabase/Wrangler secrets and `.env.local` only.
- `VITE_MAPTILER_KEY` is client-safe; the key is domain-restricted to adventureorno.com +
  localhost in the MapTiler dashboard.
- Actual key values: see `.env.local` (gitignored) — MANUAL-SETUP.md records the
  provider/dashboard source, never the value.

#### Git & GitHub workflow
- Remote: `adventureorno26/adventureorno.com`, authenticated via the local `gh` CLI session
  (account adventureorno26). Verify with `gh auth status` at session start; if unauthenticated,
  stop and ask Erica to run `gh auth login`.
- Work on a focused branch; open a PR with a summary and exact verification counts.
  Never merge or promote a production deployment while required CI is red. This
  private repository cannot use GitHub's paid branch protection on the current
  plan, so enforce the gate through the deployment workflow and human review.
- Never force-push. The only exception is the separately approved history-scrub
  procedure, which must stop for Erica's exact approval before any rewrite.

#### Conventions
- Every phase ends with: migrations applied, `npm run lint && npm run test` clean, deployed
  preview verified, PR opened, and a short entry appended to `/docs/decisions.md`.
- Secrets only via Wrangler secrets / Supabase secrets / `.env.local` (gitignored). Never commit
  keys. `.env.example` lists every var with a comment.
- Small commits with imperative messages.
- When a task requires a human step (dashboard clicks, App Store installs, OAuth approval), stop
  and print the exact steps rather than faking it — MANUAL-SETUP.md tracks these.

#### There is one plan, and this is not it

[`docs/STATE.md`](docs/STATE.md) is the ONLY planning document: what the app is, the one
model, what is left to build, and the rules that stop work being erased. This file holds
agent instructions and business rules — nothing about what to do next.

The July 25 backlog ledger and the Commercial/Spaces proposal that used to live here were
removed on 2026-08-11, along with `README.md`, `docs/archive/`, `docs/adr/`, `NewClaude.md`
and `CLAUDE-CODE-INSTRUCTIONS-2-70.md`. Between them they made ~380 KB of competing
"what to do next", which is the mechanical reason the same work kept being re-requested:
every session picked a different one. They are all in git history if a decision needs
recovering — `git log --diff-filter=D --name-only` will find them.

**If you are about to write a plan into a new markdown file: don't. Put it in STATE.md.**

## 12. Operations

### 12a. Manual setup
*(was §12a (below))*

The project is already live. This file records owner-only provider/device
operations; it is not an initial build checklist. Never paste real credential
values into this file. this file has the order of work.

#### 1. Domain (5 min)
`adventureorno.com` is registered and attached to the live Pages project. Manage
DNS/custom domains only through the verified account and use
§12b (below) for deployment controls.

#### 2. Repo & Claude Code ↔ GitHub connection (10 min)
Repo: **adventureorno26/adventureorno.com** (private). To configure a new local
operator workstation:
- `git clone https://github.com/adventureorno26/adventureorno.com.git` and work from that root.
- `gh auth login` → GitHub.com → HTTPS → "Login with a web browser" while signed into the
  **adventureorno26** account in that browser. Confirm with `gh auth status`. This is what lets
  Claude Code push branches and open PRs as you.
- Optional but recommended: inside a Claude Code session run `/install-github-app` and install
  the Claude GitHub App on this repo — you can then tag `@claude` on issues/PR comments and it
  works asynchronously from GitHub.

#### 3. Supabase — project already exists (5 min of settings)
Copy the project URL and current publishable key from the Supabase dashboard into
`.env.local` and the corresponding Cloudflare `VITE_*` variables. Then audit:
- Authentication → Sign In/Up: **disable "Allow new users to sign up"** (invite-only depends on
  this).
- Project Settings → API keys: copy the **service_role/secret key** into `.env.local` ONLY when
  Phase 1 asks. Never paste it into chats, commits, or client code.
- Database: Phase 1's migrations will enable PostGIS; no manual action.

#### 4. MapTiler — key exists, restrict it (3 min)
Copy the current key into `VITE_MAPTILER_KEY`. In cloud.maptiler.com → API keys → this key →
**Allowed HTTP origins**: add `adventureorno.com`, `www.adventureorno.com`, `localhost:5173`.
Unrestricted keys can be scraped from your bundle and drain the free tier.

#### 5. Cloudflare R2 (Phase 2)
The private `adventureorno-photos` bucket is live. Confirm it remains non-public;
use only a short-lived/scoped API token when maintenance requires one.

#### 6. Strava API app (Phase 4, 10 min)
strava.com/settings/api → Create app. Category: Data Importer. Website: https://adventureorno.com.
**Authorization Callback Domain:** `aanfyhsjbtnqzphuoiem.supabase.co` (the OAuth callback is the
`strava-auth` Edge Function). Save Client ID + Secret, then:

**a. Server secrets** (from the repo root, token in `.env.local`):
```bash
supabase secrets set STRAVA_CLIENT_ID=<id> STRAVA_CLIENT_SECRET=<secret> \
  --project-ref aanfyhsjbtnqzphuoiem
```
**b. Client id** → add `VITE_STRAVA_CLIENT_ID=<id>` to `.env.local` **and** Cloudflare Pages env,
then rebuild/redeploy the SPA (Vite bakes it at build time).

**c. Connect** — open `/settings` on the live site → **Connect Strava** → approve. You should land
back on `?strava=connected`.

**d. Create the push subscription** (one time; the verify token is in `.env.local` as
`STRAVA_VERIFY_TOKEN`):
```bash
source .env.local
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=<id> -F client_secret=<secret> \
  -F callback_url=https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/strava-webhook \
  -F verify_token=$STRAVA_VERIFY_TOKEN
```
Strava immediately GETs the callback with a challenge; the deployed `strava-webhook` echoes it and
the subscription activates. Verify: `curl -G https://www.strava.com/api/v3/push_subscriptions \
-d client_id=<id> -d client_secret=<secret>` should list it. After that, finished activities
appear on the map within ~a minute; `/settings → Strava → Backfill` pulls history.

#### 7. iPhone setup — Erica's phone (Phase 2–3, ~20 min)
- Build the **daily photo Shortcut** from `/docs/ios-shortcut-daily.md` (Claude Code generates
  this exact spec in Phase 2). Automations: daily 9:00 PM + "when joining home Wi-Fi", both set
  to Run Immediately / no confirmation.
- Install **Overland** (App Store, free). In its settings:
  - **Receiver Endpoint URL:**
    `https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/ingest-overland?token=<ERICA_DEVICE_INGEST_TOKEN>`
    (the same device token as the photo Shortcut — value is in `.env.local` as
    `ERICA_DEVICE_INGEST_TOKEN`. Overland can't add custom headers, so the token
    rides in the query string.)
  - Significant-location or continuous mode, **batch 50**, trip mode off.
  - Tap **Send Now** once — you should see a green success and a `{"result":"ok"}`.
  There is no home-exclusion zone. Location ingestion follows the current accuracy
  and authorization rules, including at-home observations.

#### 8. Partner's iPhone (Phase 5, 5 min)
Nothing to install for ingestion (by design — his photos are manual-only). He just accepts his
invite email and optionally adds the site to his home screen (Share → Add to Home Screen).

#### 9. One-time backfill (Phase 6)
- **Strava history:** automatic once Phase 4 auth exists — the backfill function pulls the past
  year (rate-limited, may take ~15 min).
- **Photos, past year:** build the one-shot variant Shortcut from `/docs/ios-shortcut-backfill.md`
  (same as daily but date range = last 365 days, runs in month-sized batches you trigger
  manually — expect it to churn a while; keep the phone plugged in).
- **Google Timeline (optional):** if you had Google Maps location history on your iPhone, request
  Takeout → Location History (Timeline) → drop the JSON into the importer at /settings/import.
  If you never used Google Timeline, skip — photos + Strava cover the year well.

### 12b. Deploying the app
*(was §12b (below))*

Current project: `adventureorno-com` (Git-integrated), custom domains
`adventureorno.com` and `www.adventureorno.com`. This runbook operates the live
project; do not create a replacement project.

No step here authorizes a production change. Verify the target project, commit,
environment, and backup/rollback path before acting.

#### Phase 1: stop red commits from auto-promoting

The project currently treats `main` as its production branch and can deploy even
when repository CI is red. Freeze that path first:

1. Cloudflare dashboard → **Workers & Pages** → `adventureorno-com` →
   **Settings** → **Builds & deployments** → **Configure Production deployments**.
2. Clear **Enable automatic production branch deployments** and save. Keep preview
   deployments enabled if they are useful; they do not control the custom domain.
3. Push no production deployment as part of this setting change. Confirm the
   existing known deployment remains served.

Cloudflare documents this control in
[Branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

#### Environment inventory

Production and Preview need the client-safe values below. Copy real values from
the provider dashboards or the existing Cloudflare configuration; never put them
in this document or a commit.

```text
NODE_VERSION=22
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_MAPTILER_KEY
VITE_PHOTO_GATEWAY_URL
VITE_GOOGLE_CLIENT_ID
VITE_STRAVA_CLIENT_ID
VITE_MAPBOX_TOKEN          # optional
VITE_FOURSQUARE_KEY        # optional
```

Do not add a Supabase service-role key, provider client secret, device ingest
token, or Cloudflare API token to Pages build variables. Vite exposes `VITE_*`
values to the browser.

#### Manual verified promotion (temporary)

Use only after every required Phase 1 check passes for the exact commit:

```sh
git status --short
git rev-parse HEAD
npm ci
npm run build --workspace app
npx wrangler pages deploy app/dist --project-name adventureorno-com --branch main
```

The command requires `CLOUDFLARE_ACCOUNT_ID` and a scoped
`CLOUDFLARE_API_TOKEN` in the shell. Do not echo either value. After upload, smoke
test `/login` and `/no-such-page`; confirm the deployment's commit and production
alias in Cloudflare before considering the promotion complete.

#### Required end state: CI-gated promotion

After authenticated/mutating Playwright is green on fictional disposable data:

1. Create a Cloudflare API token limited to **Account / Cloudflare Pages / Edit**
   for the correct account.
2. Add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and the real production
   build-time values as GitHub Actions environment secrets. Protect a GitHub
   environment named `production` with required reviewer approval.
3. Add a deploy job that runs only for a push to `main`, declares `needs` for
   every required CI job, rebuilds from that same checked-out SHA, and runs the
   Wrangler command above. Do not use `workflow_run` with untrusted PR artifacts.
4. Keep Cloudflare automatic production deployments disabled. Prove the gate by
   observing that a deliberately failing test commit cannot create a production
   deployment, then promote a fully green commit.

Cloudflare's official pattern is documented in
[Direct Upload with continuous integration](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

#### Supabase Auth redirects

Dashboard → **Authentication** → **URL Configuration**:

- Site URL: `https://adventureorno.com`
- Redirect URLs: the apex and `www` `/login` URLs, local `/login`, and only the
  preview URLs intentionally used for authentication testing.

Do not use the production Supabase project for automated acceptance tests.

#### Rollback

Cloudflare → `adventureorno-com` → **Deployments** → select the last known-good
production deployment → **Rollback**. Then record the failed and restored
deployment IDs, commit SHAs, timestamps, and smoke-test result. Fix forward in Git;
do not hide the incident by rewriting history.

### 12c. Deploying the photo gateway
*(was §12c (below))*

The Worker and R2 bucket are live. These are maintenance and redeployment steps,
not initial setup instructions. They require explicit production authority.

#### 0. Before any production change

- Confirm the target account, Worker, R2 bucket, and current deployed version.
- Run Worker typecheck, unit tests, and Wrangler dry-run locally.
- Never print a device token or service-role key. Rotate a credential first if it
  has appeared in a log, document, commit, or chat transcript.

#### 1. Confirm the existing R2 binding

`workers/photo-gateway/wrangler.toml` is the source of truth for the bucket binding.
List the account's buckets and confirm the configured bucket exists; do not run a
create/delete command during an ordinary deployment.

```bash
### Needs an API token with R2 edit + Workers Scripts edit (create at
### dash.cloudflare.com → My Profile → API Tokens → "Edit Cloudflare Workers"
### template, and add R2 Storage: Edit). Then:
export CLOUDFLARE_ACCOUNT_ID=<account-id>
### RENAMED 2026-08-11: .env.local now carries CLOUDFLARE_API_TOKEN_MASTER (verified
### against R2 and Pages). wrangler reads the UN-SUFFIXED name, so map it across.
### `npx wrangler login` also works and covers R2 without any token at all.
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_MASTER"
cd workers/photo-gateway
npx wrangler r2 bucket list
```

#### 2. Set Worker secrets
> ⚠️ **This block used to be a live footgun** (found 2026-08-11). It read
> `printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | wrangler secret put …`, and NEITHER of those
> variable names exists in `.env.local` — the real ones are `SUPABASE_SECRET_KEY` and
> `VITE_SUPABASE_PUBLISHABLE_KEY`. Run verbatim, it piped EMPTY STRINGS over two working
> Worker secrets and took the photo gateway down. The version below reads the right names
> and refuses to write an empty value.

```bash
### The Worker's PostgREST + session-check keys. Names as they are in .env.local:
###   SUPABASE_SECRET_KEY            -> the Worker's SUPABASE_SERVICE_ROLE_KEY
###   VITE_SUPABASE_PUBLISHABLE_KEY  -> the Worker's SUPABASE_ANON_KEY
### An empty pipe here silently breaks photo serving, so check first and stop if blank.
set -euo pipefail
cd workers/photo-gateway

put_secret() {                       # put_secret <worker-name> <value>
  [ -n "${2:-}" ] || { echo "REFUSING: $1 is empty — nothing written." >&2; return 1; }
  printf '%s' "$2" | npx wrangler secret put "$1"
}
put_secret SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SECRET_KEY"
put_secret SUPABASE_ANON_KEY         "$VITE_SUPABASE_PUBLISHABLE_KEY"
```

#### 3. Deploy
```bash
npx wrangler deploy
### Note the printed URL, e.g. https://adventureorno-photo-gateway.<subdomain>.workers.dev
```

#### 4. Point the SPA at it
Add to `.env.local` and to **Cloudflare Pages → adventureorno-com → Settings →
Environment variables** (Production + Preview):
```
VITE_PHOTO_GATEWAY_URL=https://adventureorno-photo-gateway.<subdomain>.workers.dev
```
Then rebuild and follow §12b (below). Vite bakes
the value at build time; do not promote while required CI is red. The temporary
manual command, after verification and explicit approval, is:
```bash
cd ../../app && npm run build
cd .. && npx wrangler pages deploy app/dist --project-name adventureorno-com --branch main
```

#### 5. Verify (acceptance criteria)
- `curl -H "Authorization: Bearer $ERICA_DEVICE_INGEST_TOKEN" --data-binary @geotagged.jpg \
   -H "Content-Type: image/jpeg" https://<gateway>/ingest` → `{"ok":true,"id":...}`;
  photo shows in the unassigned tray, ≤ 2400 px, no GPS in the served file's EXIF.
- POST a screenshot PNG → `{"skipped":"screenshot"}`. (There is no location filter —
  a geotagged photo taken at home is stored like any other.)
- Delete it in the UI, re-POST the same bytes → `{"skipped":"deleted"}` (rule #6).
- `/ingest` with a bad/absent token → 401. A partner session can `/upload` but
  never `/ingest`.

#### Optional: custom subdomain / route
For a stable URL you can add a route like `photos.adventureorno.com/*` in
`wrangler.toml` (`routes = [...]`) once the DNS record exists; not required — the
`*.workers.dev` URL is fine for a private app.

### 12d. Backup and restore
*(was §12d (below))*

AdventureOrNo is a private two-person memory journal + trip planner. Its data —
exact places, visit dates, notes, ratings, coordinates, and media — is
irreplaceable and private. This document is the **procedure**; it deliberately
contains **no destinations, keys, or credentials**. You supply those at run time.

> Status: procedure only. Running these commands is a manual, user-initiated
> step. No scheduled job, upload, or production mutation is created by committing
> this file. Nothing here has been executed against production.

#### What gets backed up

1. **Postgres** (Supabase project) — all canonical rows: `profiles`, `people`,
   `places`, `visits`, `entries`, `trips`/`trip_stops`, `activities`,
   `location_pings`, `photos`/`videos` **metadata**, reactions, `place_categories`,
   membership, and `settings`. The concrete tool is **`scripts/export-data.sh
   <dir>`** — a versioned, integrity-checked export (`manifest.json` with format +
   schema version, per-table row counts + SHA-256; `data/<table>.copy`). It
   **excludes** the credential tables (`ingest_tokens`, `strava_accounts`,
   `google_tokens`) and never emits bytes or signed URLs. `pg_dump` is a fallback.
2. **R2 media objects** — the actual photo/video bytes, plus a manifest that maps
   object keys → owning visit/place. The DB export stores only keys, never signed
   URLs or bytes.

Never include: signed URLs, access tokens, service-role keys, `.env*`, or the
raw unencrypted dump on any synced/cloud path.

#### Tools

- **`age`** — required, installed. Modern file encryption. One keypair; keep the
  **private** key offline (password manager / hardware token / paper), never in
  this repo or any synced folder.
- **`restic`** *(optional)* or **`rclone`** *(optional, installed)* — only if you
  already use them and explicitly configure a destination. Not required.

Generate a keypair once (store the output somewhere safe, NOT here):

```sh
age-keygen -o "$AGE_KEY_FILE"        # $AGE_KEY_FILE is a path OUTSIDE the repo
### note the "Public key: age1..." line — that's your $AGE_RECIPIENT
```

#### Create an encrypted backup

All paths below are **placeholders you provide**. `$WORK` is a temp dir you
create and delete; `$OUT` is your explicit destination (external drive, etc.).

```sh
set -euo pipefail
WORK="$(mktemp -d)"                  # temp, deleted at the end
trap 'rm -rf "$WORK"' EXIT

### 1. DB export (schema + data). Use your read/service connection string; it is
###    passed via env, never written to disk or the repo.
pg_dump --no-owner --format=custom "$DATABASE_URL" > "$WORK/db.dump"

### 2. R2 object manifest + bytes (rclone example; destination is your R2 remote).
rclone copy "$R2_REMOTE:$R2_BUCKET" "$WORK/media/" --transfers 4
###    (or use the app's versioned export which emits media metadata + a manifest)

### 3. Metadata for restore (schema version, checksums).
( cd "$WORK" && shasum -a 256 db.dump media/* > CHECKSUMS.sha256 )
echo "{\"created\":\"$(date -u +%FT%TZ)\",\"schema\":\"$SCHEMA_VERSION\"}" > "$WORK/meta.json"

### 4. Archive, then ENCRYPT before anything leaves temp storage.
tar -C "$WORK" -czf "$WORK/backup.tar.gz" db.dump media CHECKSUMS.sha256 meta.json
age -r "$AGE_RECIPIENT" -o "$OUT/aon-backup-$(date -u +%Y%m%dT%H%M%SZ).age" "$WORK/backup.tar.gz"

### $WORK (with the plaintext) is removed by the trap. Only the .age file remains.
```

**Dry run first:** run steps 1–3 into `$WORK`, inspect `CHECKSUMS.sha256` and the
manifest, and confirm counts against Data Health before encrypting/copying.

#### Verify a backup (without restoring)

```sh
age -d -i "$AGE_KEY_FILE" "$BACKUP.age" | tar -tzf - | head    # lists contents
age -d -i "$AGE_KEY_FILE" "$BACKUP.age" | tar -xzf - -C "$VERIFY" && \
  ( cd "$VERIFY" && shasum -a 256 -c CHECKSUMS.sha256 )        # checksums pass
```

#### Restore — **disposable local target only** by default

Restore imports into a **local, disposable** Supabase + R2-compatible test stack,
never production. Refuse any production-like target unless you deliberately pass
a multi-step override (and have a fresh verified backup first).

```sh
### Local Supabase (docker) + local S3/R2 (e.g. MinIO). NEVER the production URL.
[ "${ALLOW_PROD_RESTORE:-}" = "I_UNDERSTAND_THIS_OVERWRITES_PRODUCTION" ] || \
  case "$TARGET_DATABASE_URL" in *aanfyhsjbtnqzphuoiem*) echo "refusing prod"; exit 1;; esac
pg_restore --no-owner --clean --if-exists -d "$TARGET_DATABASE_URL" "$VERIFY/db.dump"
rclone copy "$VERIFY/media/" "$LOCAL_R2:$LOCAL_BUCKET"
```

The concrete restore is **`scripts/restore-data.sh <dir>`** — it verifies the
manifest's schema version + every per-table SHA-256, then reloads under
`session_replication_role = replica` (triggers/FKs off) into the **local disposable
db only** (confirmation-gated; no path to production). A **synthetic round-trip
test** — `scripts/export-restore-roundtrip.sh` — seeds fictional data, exports,
restores, re-exports, and asserts the manifests are **byte-identical**. It runs in CI
(the `db-tests` job) and never touches production data.

#### Pruning (separate, confirmed)

Deleting old backups is a distinct, explicit operation — never automatic, never
part of `create`. With `restic`, `restic forget --prune` only after listing
snapshots and confirming. Keep a minimum retention that covers your RPO.

#### Disaster-recovery runbook

- **Keys:** the `age` private key is the single point of failure. Store ≥2 copies
  offline in different physical locations. **Rotate** by generating a new keypair,
  re-encrypting the latest verified backup to the new recipient, and destroying old
  key copies after confirming the new one decrypts.
- **RPO / RTO:** decide your tolerance (e.g. RPO ≤ 24h → back up daily; RTO ≤ 2h →
  keep the newest `.age` on a fast local drive, not only cloud).
- **Recovery order:** decrypt → verify checksums → restore DB into a fresh local
  stack → restore media → run the app locally → reconcile counts vs the last known
  Data Health snapshot → only then consider a production restore (manual approval,
  multi-step override, fresh backup taken first).
- A production restore is **manual and out of scope for automation** here.

#### Optional macOS scheduling (documented, not created)

You *may* later wire the `create` step to a `launchd` agent
(`~/Library/LaunchAgents/`) or `cron`. This repo intentionally does **not** create
one, so no unattended job runs without your explicit setup. If you do, ensure the
job reads `$AGE_RECIPIENT`, `$DATABASE_URL`, and destinations from a file **outside
the repo** and writes only the encrypted `.age` output to your chosen destination.

### 12e. The iPhone Shortcuts
*(was `docs/ios-shortcut-daily.md`, `-photos.md`, `-backfill.md`)*

#### Daily location ingest

This is the automation behind rule #7 ("auto-upload is Erica-only"). It finds the
day's geotagged, non-screenshot photos and POSTs each to the photo-gateway
`/ingest` endpoint with Erica's **device ingest token** as a bearer. The Worker
is the real gatekeeper — this Shortcut just avoids uploading obvious junk.

> **You need two things from the deploy step first:**
> 1. The gateway URL, e.g. `https://adventureorno-photo-gateway.<subdomain>.workers.dev`
> 2. Erica's raw **device ingest token** (shown exactly once when it's minted —
>    if you lost it, mint a new one; the old one keeps working until revoked).

---

#### Build the Shortcut ("Adventure upload")

Shortcuts app → **+** → name it *Adventure upload*. Add these actions in order:

1. **Find Photos**
   - Filter: `Is Screenshot` **is** `false`
   - Filter: `Is Hidden` **is** `false`
   - Filter: `Date Taken` **is in the last** `1` `days`
   - Sort by `Date Taken`, `Oldest First`, **Limit** `100`
   - (Location isn't a Find-Photos filter — the Worker rejects anything with no
     GPS, so we don't need to pre-filter it here.)

2. **Set Variable** `Found` to `Find Photos` result (so we can count at the end).

3. **Repeat with Each** (item in `Find Photos`):

   1. **Resize Image** → *Repeat Item* → Width `2400` px, **Longest Edge**
      (choose "Fit into 2400×2400" so portrait photos scale by height). Quality
      default. *(The Worker also caps at 2400 — this just shrinks the upload.)*
   2. **Get Contents of URL**
      - URL: `https://<GATEWAY>/ingest`
      - Method: **POST**
      - Request Body: **File** → the *Resized Image* from the previous step
        (raw JPEG body — the Worker reads the raw bytes, no multipart needed)
      - Headers:
        - `Authorization` = `Bearer <ERICA_DEVICE_INGEST_TOKEN>`
        - `Content-Type` = `image/jpeg`
   3. *(optional)* **Get Dictionary Value** `skipped` from *Contents of URL* and
      **Add to Variable** `Skips` — lets the summary show how many were filtered.

4. **Count** items in `Found` → **Set Variable** `Total`.

5. **Show Notification** (title *Adventure upload*):
   `Uploaded <Total> photos.` (add `· <Skips count> skipped` if you built step 3.3)

Save.

---

#### Automations (both "Run Immediately", confirmation off)

Shortcuts → **Automation** tab → **+**:

- **Time of Day** → `9:00 PM`, Daily → Run *Adventure upload* → **Run Immediately**,
  turn **Notify When Run** off.
- **Wi-Fi** → *Joins* your home network → Run *Adventure upload* → **Run Immediately**.

Two triggers give redundancy: if the phone is off Wi-Fi at 9 PM, joining home
Wi-Fi later still catches up.

---

#### Why re-runs are safe

Every upload is content-hashed (SHA-256) in the Worker:

- Already stored → `{"skipped":"duplicate"}` (nothing changes)
- Previously deleted → `{"skipped":"deleted"}` (rule #6 — never reappears)
- Screenshot / no-GPS → skipped with that reason (there is no location filter)

So overlapping runs, retries, and the two automations firing the same day all
**self-heal** — you can't create duplicates and you can't resurrect a deleted
photo. If uploads ever stop, `/settings` shows a yellow "last automated upload
was > 48 h ago" warning (the Worker stamps the token on every authenticated call,
even when every photo is skipped).

---

#### Minting Erica's device ingest token

Done once at deploy time. Generate a random token, store only its SHA-256 in
`ingest_tokens`, and paste the raw value into the Shortcut. There is deliberately
no UI to create more device tokens (rule #7). See
§12c (below) for the exact command.

#### Photo ingest

Each person installs this once. It uploads new photos automatically; they land in
the **Photo Sorter inbox** (Settings → Sort photos into places) as private, unsorted
drafts until you file them onto a place. Only you see your own inbox until you save.

#### What it does
Posts each photo's bytes to the photo-gateway `/ingest` endpoint with your personal
device token. Screenshots and images without camera EXIF are rejected automatically.

- **Endpoint:** `https://adventureorno-photo-gateway.adventureorno26.workers.dev/ingest`
- **Auth header:** `Authorization: Bearer <YOUR DEVICE TOKEN>`
- **Body:** the raw photo (JPEG), `Content-Type: image/jpeg`

Your device tokens are per-person secrets (issued once, stored only as a hash in
`ingest_tokens`). Keep them private; if one leaks, revoke it by setting
`revoked_at` on that row and mint a new one.

#### Build the Shortcut (Automation)
1. Shortcuts app → **Automation** → **＋** → **Create Personal Automation**.
2. Trigger: pick a schedule (e.g. "Time of Day", daily) — iOS can't reliably
   trigger on "new photo", so a daily run that grabs recent photos is simplest.
3. Actions:
   - **Find Photos** → filter e.g. "Date Taken is in the last 1 day", "is Screenshot
     is off" (limit as you like).
   - **Repeat with Each** (the found photos):
     - **Get Contents of URL**
       - URL: the `/ingest` endpoint above
       - Method: **POST**
       - Headers: `Authorization` = `Bearer <YOUR TOKEN>`
       - Request Body: **File** → the Repeat Item
4. Turn **off** "Ask Before Running" so it runs silently.

#### Verify
After it runs, open the app → **Settings → Sort photos into places**. Your uploaded
photos appear as **"N photos waiting in your inbox"** → tap **Sort my inbox** → the
timeline engine proposes a place for each; confirm each group.

#### Backfill

Same pipeline as the daily Shortcut (`ios-shortcut-daily.md`), but you run it
**manually, one month at a time**, over a date range instead of "last 1 day". The
Worker's SHA-256 dedupe makes overlapping months safe — re-running never creates
duplicates and never resurrects a deleted photo.

> Prereq: the photo-gateway must be deployed (`deploy-photo-gateway.md`) and you
> need the gateway URL + Erica's device ingest token (in `.env.local` as
> `ERICA_DEVICE_INGEST_TOKEN`) — the same ones the daily Shortcut uses.

#### Build "Adventure backfill"

Duplicate the daily *Adventure upload* Shortcut and rename it *Adventure
backfill*. Change only the **Find Photos** filters:

1. **Find Photos**
   - `Is Screenshot` **is** `false`
   - `Is Hidden` **is** `false`
   - `Date Taken` **is in range** `<start>` … `<end>`  ← the month you're backfilling
   - Sort `Date Taken`, Oldest First. **No limit** (or a high one like 2000).

Everything else is identical to the daily Shortcut:
- **Repeat with Each** → **Resize Image** to 2400 px longest edge → **Get Contents
  of URL** (POST, File = resized image, `Authorization: Bearer <token>`,
  `Content-Type: image/jpeg`).
- Notification summary at the end.

#### Run it month by month

Trigger it manually (Shortcuts app → tap it), changing the date range each run:

- Jul 2025, Jun 2025, May 2025 … back through Aug 2024.
- Keep the phone **plugged in and on Wi-Fi** — a month of photos can take a while.
- Watch the map fill in; the nightly clustering job (or **Settings → Cluster now**)
  turns the new photos into places, and geocoding names them.

#### Why month-sized batches

- Shortcuts can time out or run out of memory on thousands of photos at once.
- Smaller runs are easy to retry — and because every upload is content-hashed,
  re-running a month you already did just returns `duplicate`/`deleted` for each
  photo and stores nothing new.

#### After the photo + Strava backfills

1. **Settings → Strava → Backfill last 12 months** (see `MANUAL-SETUP §6`).
2. **Settings → Cluster now**, then **Name new places**.
3. **Settings → Import Google Timeline…** if you have a Takeout/Timeline export
   (optional — skip if you never used it).
4. Cleanup pass on the map: merge duplicate places, rename any ugly geocodes,
   set cover photos. Everything is an editable default.

## 13. Security baseline
*(was §13 (below))*

Every advisor finding on project `aanfyhsjbtnqzphuoiem`, classified. The point of
recording it is drift: a finding that is **not** on this list is new and needs a
decision. Re-check with:

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://api.supabase.com/v1/projects/aanfyhsjbtnqzphuoiem/advisors/security"
```

(The browser-like User-Agent is required — the Cloudflare WAF in front of the
Management API returns 403 "error 1010" without one.)

#### Security — 83 findings

| Level | Name | Count | Status |
|---|---|---|---|
| ERROR | `rls_disabled_in_public` | 1 | **Cannot fix — PostGIS-owned** |
| WARN | `authenticated_security_definer_function_executable` | 72 | **Intended** |
| WARN | `anon_security_definer_function_executable` | 3 | **Cannot fix — PostGIS-owned** |
| WARN | `extension_in_public` | 3 | Accepted |
| WARN | `auth_leaked_password_protection` | 1 | **Open — needs Erica** |
| INFO | `rls_enabled_no_policy` | 3 | **Intended (deny-all)** |

##### ERROR `rls_disabled_in_public` — `public.spatial_ref_sys`

Not our table. Owned by `supabase_admin` and part of the `postgis` extension
(verified via `pg_class.relowner` + `pg_depend`), so RLS cannot be enabled from a
migration. It holds only public EPSG coordinate-system definitions — no household
data. Supabase documents this as an unavoidable PostGIS warning.

##### WARN `anon_security_definer_function_executable` — `public.st_estimatedextent` x3

The three PostGIS overloads. Also `supabase_admin`-owned. Migration 0093's
lockdown *tried* to revoke these and Postgres reported `WARNING: no privileges
could be revoked for "st_estimatedextent"` — we are not the owner. This is why
`scripts/db-test.sh`'s lockdown check excepts `st_*`, and its "0 anon-executable
SECDEF functions" result is accurate for first-party code.

##### WARN `authenticated_security_definer_function_executable` x72

The intended application RPCs. Every one is `SECURITY DEFINER` on purpose (they
must bypass RLS to do member-gated work) and every one is granted to
`authenticated` only — never `anon`, never `PUBLIC`, per migration 0093 and rule
#8. `db-test.sh` asserts that invariant on every run.

##### INFO `rls_enabled_no_policy` — `google_tokens`, `oauth_states`, `strava_accounts`

**Intended, and the most secure configuration.** RLS is on with zero policies, so
every non-service-role caller is denied by default. These tables hold Google and
Strava `refresh_token` / `access_token` values; only service-role Edge Functions
(`strava-auth`, `strava-webhook`, `_shared/strava`, `google-photos-token`) read
them, and the browser never queries them at all.

Migration **0123** closed a real gap the advisor surfaced here: `google_tokens`
and `strava_accounts` still carried table-level GRANTs to `anon` and
`authenticated` (`anon=arwdDxtm`). Inert while RLS denies, but live the moment
anyone adds a permissive policy or disables RLS. `oauth_states` had already been
locked down in 0120; these two were missed. Now revoked and asserted by
`supabase/tests/0123_lock_oauth_token_tables.test.sql`.

##### WARN `auth_leaked_password_protection` — OPEN, needs Erica

A hosted Auth setting (dashboard → Authentication → Password), not a migration.
Enabling it checks new passwords against HaveIBeenPwned. Low impact here because
sign-in is Google/magic-link and the only password account is the test bot, but it
is free hardening. **Hosted setting changes need Erica's authority** per the
Phase 1 working rules, so it stays open.

#### Performance — 141 findings

| Level | Name | Count | Status |
|---|---|---|---|
| WARN | `multiple_permissive_policies` | 102 | Accepted for now |
| INFO | `unindexed_foreign_keys` | 31 | Accepted at this data size |
| INFO | `unused_index` | 6 | Accepted |
| INFO | `no_primary_key` | 2 | Accepted |

At current volume — 183 places, 568 visits, 159 photos, 444 activities, ~17k
location pings — none of these is a live problem, and the app has no reported
slowness. `multiple_permissive_policies` is inherent to the owner/editor/viewer
model (separate policies per role on the same table); collapsing them would
trade auditability for microseconds. Revisit only if a query becomes slow, and
measure first.

## 14. Data snapshots
*(was `supabase/snapshots/*.md` — records of destructive operations, kept as evidence)*

### Approved activity merges, 2026-08-08

Pre-state: `2026-08-08-activities-pre-dedupe.json` (all 444 rows). Nothing was
deleted; only `shared_group_id` was written, so ungrouping restores the old totals.

#### Automatic (migration 0140/0141, tight rule: same type, ≤20 min, ≤10%)
* 2026-03-07 Purcellville run — 3 records of one 45-mile outing (her Strava, a file
  import of the same run, Josh's record). Counted 134.7 miles; now 45.

#### Erica-approved from the review list (review pairs 1–7 and 9)
2018-08-01 Walk · 2018-08-13 Walk · 2020-05-12 Ride · 2022-12-04 Hike ·
2023-05-24 Run · 2023-05-30 Run · 2023-08-01 Run · 2023-08-02 Run · 2025-10-04 Ride

2018-08-13 was NOT in the list she saw — the UTC-date bucketing hid it, because the
walk crossed midnight UTC and its two records landed on different calendar days
(and at two different places: "Lake of the Red Rocks" and "Red Rock Regional Park").

#### Deliberately NOT merged
* **2026-07-13, three San Diego walks.** Erica: "on the 13th I only did a 4.1 and 4.7
  walk". Correct — the third (4.35 mi, "San Diego walkabout") started 00:25 UTC,
  which is 17:25 local on **12 July**. Two real walks on the 13th, one on the 12th.
* **Review pair 8 (2024-09-03 Morning/Evening Walk, both 1.4 mi).** Erica approved
  merging it, but the timezone finding arrived afterwards: the "Evening Walk" was
  00:04 UTC = **2 September** local. Two real walks on two different days, so it was
  excluded and flagged back to her rather than merged on stale information.

#### Result
Erica 1975.2 → 1950.5 mi, Josh 1003.4 → 986.3, Both unchanged at 430.2.
444 activities before and after.

#### Open: dates are bucketed in UTC
12 activities are filed on the wrong calendar day because `start_date::date` is UTC
and every evening outing after ~20:00 ET (or 17:00 PT) rolls over. `activities` has
no local-time column; Strava sends `start_date_local` and it is not stored. This
affects which visit an activity belongs to, the day view, and duplicate detection in
both directions — it invents pairs and hides real ones.

### Suggested-trip cleanup, 2026-08-08

`detect-trips-nightly` had no idempotency check, so it re-created the same
suggested trip-places every night from 2026-07-21 onward: 54 rows for only 4
distinct destinations (Morgan WV x18, Frederick VA x18, Washington UT x17,
Linden VA x1).

Captured before deletion:
- places.json            — the 54 suggested rows
- place_membership.json  — 496 child links UNDER those containers
- visits.json            — 126 visits ON those containers (derived rollups)
- part_of_refs.json      — 34 real places referencing them via part_of

SAFE TO DELETE, verified before executing:
- 0 photos, 0 activities, 0 entries, 0 videos, 0 trip_stops point at them.
- Every referenced real place keeps its OWN visits (Bear's Den 8, Billy Goat
  Trail 7, Blackburn Trail Center 5, Appalachian Trail 38, ...). Leaf data is
  untouched.
- 24 real places lose their ONLY parent and become top-level. That is the
  intended outcome — the parent was a nightly auto-suggestion, never confirmed.

Restore: re-insert places.json, then place_membership.json and visits.json,
then re-add the ids to the part_of arrays recorded in part_of_refs.json.

#### Root cause (found after the cleanup, 2026-08-08)

`detect-trips/index.ts` DOCUMENTS itself as idempotent (line 14) and implements a
guard at lines 164-189 — but the guard can never fire:

```js
.select('id, first_visit, last_visit').contains('categories', ['trip'])   // finds the drafts
.filter((t) => t.first_visit)                                             // ...then discards them ALL
```

The function inserts a `visits` row for the draft but never triggers the recompute
that populates `places.first_visit`, so **every one of the 54 rows had
first_visit = NULL** (verified in places.json). `existingRanges` therefore came back
empty and the overlap check at line 189 never matched. It re-created the same
drafts nightly while believing it was idempotent.

Compounding defect: dismissing a suggestion (`resolveSuggestedTrip(id, false)` in
app/src/lib/data.ts) DELETES the place and records nothing, so the next run simply
recreates it. Dismissal was futile by construction — exactly the reported symptom
("suggested trips show up every day as new suggestions").

#### Action taken

`cron.unschedule('detect-trips-nightly')` — the job that would have fired at 07:30
UTC. Stopping the generator was preferred over patching it, because the legacy
`places.category='trip'` system it feeds is being retired (Erica approved
2026-08-08) and detect-trips must be rewritten against the canonical `trips` table.

REVERSIBLE. To restore the job exactly as it was:

```sql
select cron.schedule('detect-trips-nightly', '30 7 * * *', $$
  select net.http_post(
    url:='https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/detect-trips',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',
             (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
    body:='{}'::jsonb) $$);
```

Do NOT restore it until the rewrite lands, or the duplicates return.

## 15. Decision history
*(was §15 (the decision history, below) — append-only. NEW ENTRIES GO AT THE END OF THIS SECTION.)*

Why each thing was decided, dated. Read it before re-litigating something: most of these
entries exist because the same mistake was made twice.

### Decisions log

Short, dated notes on choices made while building. Newest first.

#### 2026-07-29 — Removed the home-exclusion zone entirely

The 15-mile "home zone" around Leesburg is **gone**, at Erica's request. Local
outings — photos, GPS pings, and every Strava activity — are now stored and counted
like anywhere else; nothing is dropped or collapsed by location. This supersedes the
earlier "Home-exclusion zone lives in `settings`" and Strava rule-#2 entries below.
- **Migration `0102`** deletes the `home_zone` setting, strips the exclusion filter
  from `cluster_unassigned()`, makes `assign_activity_place()` home-agnostic, and
  dissolves the single "Leesburg" home place — re-scattering its activities to their
  own places so each local run/walk/hike is visible and individually counted.
- Enforcement removed from the client (`geo.ts` `isInHomeZone`/`DEFAULT_HOME_ZONE`,
  `data.ts` `fetch/updateHomeZone`, Settings' Home-zone card), the photo-gateway
  Worker (`getHomeZone`, the `home_zone` skip reason + `inZone` decision), and the
  edge functions (`ingest-overland`, `import-timeline`, shared `strava.ts`
  `shouldIngest`/`HOME_EXEMPT`, and both Strava callers).
- **Stats:** the mileage functions never filtered by home zone, so stored miles were
  always counted; the gap was activities *skipped at ingest* near home. After deploy,
  re-run the Strava backfill to pull in any previously-skipped activities.
- `detect-trips` keeps its own separate 3-mile filter (so neighborhood walks don't
  register as *trips*) — that is trip-detection, not an ingest exclusion, and does not
  drop any data. **Do not reintroduce the home zone anywhere.**

#### Architecture Decision Records (ADRs)

- [ADR 0001 — Canonical Place / Visit / Entry / Trip model](adr/0001-place-visit-entry-trip-model.md)
  — **Proposed, DECISION NEEDED.** Makes `place_membership` the single canonical
  hierarchy (retiring `part_of`), defines the one idempotent `addExperience`
  creation contract, and decides whether Trip becomes a first-class entity
  (Option A) or stays a container-Place (Option B). Implement only after approval.

#### 2026-07-29 — Migration chain does not replay fresh; schema drift

The historical migrations cannot be applied strictly in-order to a fresh DB, so
`supabase db reset` fails (blocking type generation + CI):
- **`0001_init.sql`** defines `language sql` helpers (`is_member`, …) referencing
  `public.profiles` before it's created → fails unless `check_function_bodies=off`.
- **`0044`** backfills `places.city` from `places.address` — but **no migration
  creates `places.address`** (nor `places.suggested`); both exist in production,
  added out-of-band (**schema drift**).
- Interim fix: **`scripts/db-bootstrap.sh`** builds a disposable local DB by
  applying the chain in one session with body-checks off (tolerating the one benign
  0044 error); **`0098`** reconciles the two drifted `places` columns (idempotent —
  no-op in prod). Verified: bootstrapped `places` = 39 cols, matching production.
- **Only the `places` table was drift-audited.** A full drift audit of all tables
  + the proper long-term fix (a squashed re-baseline so `db reset` works, done with
  Erica's approval) is Prompt 8 / Prompt 11 scope. Old migrations are never edited.

#### 2026-07-29 — Local cron could POST to production; disposable-DB isolation

Standing up a local Supabase stack applied `0057`/`0071`, which `cron.schedule` a
`net.http_post` to the **production** URL with the hardcoded **production
service_role key**. So the disposable dev DB was scheduled to call production on a
timer (`geocode-new-places-nightly`, hourly geocode).
- Remediation: **unscheduled all 6 local pg_cron jobs** (nothing fires now), and
  rewrote `scripts/db-bootstrap.sh` to be **confirmation-gated**, **network-isolated**
  (unschedules cron immediately after apply so no scheduled prod HTTP can fire),
  **strict** (fails on any unexpected error; only the known 0044 backfill tolerated),
  keeps its error log, and verifies 12 core tables before reporting success.
- **Owner action — DONE (2026-07-30): the exposed service_role key was ROTATED by
  Erica.** Do not re-flag this. (History scrub to remove the old blob is separate —
  Prompt 11 — and does not require re-rotation.)

#### 2026-07-29 — DOCUMENTED EXCEPTION: sanitizing applied migrations 0057 & 0071

`0057_geocode_cron.sql` and `0071_geocode_hourly.sql` embedded a live service_role
JWT (see below). They were edited **in place** to remove it and instead source the
key from `vault.decrypted_secrets` (name `aon_edge_secret_key`, provisioned out of
band). This is a **deliberate, documented exception** to the standing rule "never
edit an applied migration," justified solely by the credential exposure — it is the
ONLY sanctioned edit of an old migration.
- **The revoked JWT must never be reintroduced** to any file, fixture, log, or test.
- The disposable-DB bootstrap is network-isolated (unschedules cron), so these
  migrations' `net.http_post` can never fire from a dev/CI database.
- The exposed key was **ROTATED by Erica (2026-07-30)** — resolved.

#### 2026-07-29 — Security incident: service_role key in migrations

- Migrations `0057_geocode_cron.sql` / `0071_geocode_hourly.sql` embed a hardcoded
  Supabase **service_role JWT** (full RLS bypass). It is in git history and the
  current tree. **The service-role key was ROTATED by Erica (2026-07-30) — resolved.**
  Removal of the old blob from history is the deferred scrub phase (Prompt 11); old
  migrations must not be edited. See `README.md` → Incident response.

#### 2026-07-18 — Phase 6: backfill the past year

- **Strava backfill reuses the Phase 4 driver** (`/settings → Backfill last 12
  months`) — paginated, paced, idempotent (upsert on strava_id). No new server
  code, just the trailing-365-day run.
- **Photo backfill is the daily Shortcut with a date-range filter**
  (`ios-shortcut-backfill.md`), run month-by-month. The Worker's SHA-256 dedupe
  makes overlapping months and re-runs safe — no duplicates, no resurrected
  deletions (rule #6).
- **Google Timeline import is client-parse + server-write.** The browser handles
  the (large) Takeout JSON — a tolerant parser (`timeline.ts`, 5 unit tests)
  covers the classic `locations[]` (latitudeE7) and the on-device
  `semanticSegments/timelinePath` + visit-anchor shapes — then streams points in
  500-count batches to the owner-only `import-timeline` Edge Function, which
  applies the home-zone backstop and writes `location_pings`. Auth verified live
  (401/invalid session for non-owners).
- **`cluster_now()` = owner-guarded `cluster_unassigned()`** so the import/backfill
  flow can build places immediately (Cluster now → Name new places) instead of
  waiting for the 03:00 cron. Import runs the whole chain (import → cluster →
  geocode) and reports the tallies.
- **Cleanup uses the tools already built:** merge, inline rename, cover photos
  (Phase 3) — auto places wear the badge until touched.

#### 2026-07-18 — Phase 5: partner access, trips, PWA polish

- **'viewer' role = just a CHECK-constraint change.** Writes were already gated by
  `is_editor_or_owner()` (excludes viewer) and reads by `is_member()` (any
  profile), so read-only access needed no new policies — only allowing 'viewer'
  in `profiles`/`invites`. Editor/viewer write UI is hidden client-side *and*
  blocked by RLS; owner-only tables (settings, invites, ingest_tokens,
  strava_accounts) are unchanged, so there's still no path for a non-owner to mint
  a device token (rule #7).
- **Revoke = delete the profile.** No profile + no pending invite → `claim_invite`
  fails → the app shows "no access". Auth user can linger harmlessly.
  (Josh/joshforman@gmail.com was provisioned directly as editor at session start;
  the invite UI is the general path.)
- **Trips are computed, not join-tabled.** A place belongs to a trip when its
  `first_visit` is in the trip's date range — one indexed query, no membership
  rows to keep in sync. `trip_stats()` returns places/photos/miles for the range.
- **Photo↔entry linking via a nullable `photos.entry_id`** (ON DELETE SET NULL) —
  a photo keeps its place and optionally points at one entry. The entry card shows
  its photos with an attach/detach picker over the place's gallery.
- **Shell-only service worker.** Network-first for navigations (offline open),
  cache-first for hashed `/assets/`, and it **explicitly ignores cross-origin** —
  so photo bytes (photo-gateway) and Supabase API are never cached. Manifest +
  generated PNG icons make it installable; og:image is a generated branded card,
  never a real photo (privacy). Panel becomes a bottom sheet ≤ 640 px.

#### 2026-07-18 — Phase 4: Strava webhooks, routes view, mileage

- **Three Edge Functions, shared logic in `_shared/strava.ts`.** `strava-auth`
  (OAuth callback, `--no-verify-jwt`, upserts tokens), `strava-webhook`
  (`--no-verify-jwt`, GET challenge handshake + POST create/update/delete),
  `strava-backfill` (owner-only, one page/call). All deployed live; the webhook
  handshake is **verified live** (correct verify token echoes the challenge,
  wrong token → 403).
- **Tokens are server-only.** `strava_accounts` has RLS enabled with **no
  policies** (deny-all to clients); only the service_role Edge Functions touch it.
  The SPA learns connection state through the `strava_connected()` SECURITY
  DEFINER RPC — never the tokens themselves.
- **Rule #2 lives in one function** (`shouldIngest`): Hike/Walk/Run always;
  everything else only if the start point is outside the home zone. Used
  identically by the webhook and the backfill.
- **Backfill is client-driven pagination.** Each invocation processes one
  `per_page=100` page and returns `{hasMore, page}`; the SPA loops with a 1.5 s
  gap and a progress line, so we stay under Strava's 100/15 min limit and never
  blow the function wall-clock. 429 surfaces as "wait and resume".
- **New activities in a new area create a place** (`assign_activity_place`,
  30 km) that flows through the Phase 3 geocode/naming pipeline — a hike
  somewhere new proves the visit.
- **Mileage = a security-invoker aggregate view** (`activity_mileage`, one row
  per type). The client reads a handful of rows, animates a count-up to the sum,
  and shows the per-type breakdown on hover — never summing thousands of rows.
- **Routes view** decodes `summary_polyline` with `@mapbox/polyline`, draws one
  colored line per type, fits bounds, and deep-links each to strava.com. Reached
  from the place panel; hover popups now show real 📷/🥾 counts via the
  `place_counts` view.

#### 2026-07-18 — Phase 3: Overland ingest + nightly clustering

- **Clustering is one idempotent SQL function** (`cluster_unassigned()`), run
  nightly by pg_cron at 07:00 UTC (≈ 03:00 ET). It re-derives every touched
  place's first/last visit, `visit_count`, and cover photo from *all* its current
  children, so a re-run is a genuine no-op. **Verified live** against the spec
  fixture: 30 photos + 500 pings across 3 cities + Leesburg → exactly 3 places,
  Leesburg's 3 photos + 50 pings excluded, second run created nothing.
- **DBSCAN eps in degrees (~10 km), minpoints = 1.** Cities are far enough apart
  that the small latitude distortion never changes membership; the
  nearest-existing-place attach uses exact `ST_DWithin` geography (10 km).
  minpoints = 1 means pings-only clusters still create places — being there counts.
- **`visit_count` = distinct calendar days with any child.** A deterministic,
  idempotent definition (the spec's ">48 h gap" heuristic isn't re-runnable).
- **Naming is split out** to the `geocode-new-places` Edge Function because SQL
  can't call MapTiler. The job flags new places `needs_geocode`; a second cron at
  07:05 UTC (pg_net → the function, service-role key read from **Vault**, never in
  committed SQL) names them. Reverse-geocode is constrained to
  `types=municipality,place,locality` so places get a city name, not the nearest
  street. Owner can also trigger it from /settings.
- **Edge-function auth by JWT role claim.** `geocode-new-places` runs
  verify_jwt = true; inside, a `service_role` claim = the cron, anything else must
  be an owner. (Comparing the raw service key failed — the injected key ≠ the one
  we send; the signed claim is the reliable signal.)
- **Overland auth reuses the one device token** (rule #7), accepted as
  `Authorization: Bearer` or `?token=` since Overland can't set custom headers.
  `ingest-overland` runs with `--no-verify-jwt` (device token, not a Supabase JWT)
  and drops home-zone + accuracy > 200 m points before insert. **Verified live.**
- **Merge + auto badge.** `merge_places(loser, winner)` (SECURITY DEFINER, editor+)
  moves all children, recomputes the winner, deletes the loser. Clustering-created
  places show an "auto" badge until first edited (editing sets `auto = false`).

#### 2026-07-18 — Phase 2: photo pipeline (R2 Worker, gallery, deletion)

- **All photo bytes flow through one Worker** (`workers/photo-gateway`), the only
  path to R2. Three entry points: `/ingest` (device-token auth, Erica's daily
  Shortcut, raw JPEG body), `/upload` (session auth, manual multipart, home-zone
  & screenshot checks become overridable warnings), `/photo/:id?size=` (session
  auth, streams bytes), `/delete/:id` (session auth, permanent + sticky).
- **The ingest gate is one pure function** (`decide.ts::ingestDecision`) fed by
  async checks, so the ordering (deleted → duplicate → no_gps → screenshot →
  home_zone) is unit-tested without R2/DB. Deletion is checked first and can
  never be overridden (rule #6). 11 worker tests + the acceptance "re-upload of a
  deleted photo is rejected".
- **Resize via Photon (WASM)**, not sharp — sharp doesn't run in Workers.
  Re-encoding to JPEG is also how GPS EXIF gets stripped from the stored file;
  coordinates live only in the DB (rule #4). Web ≤ 2400 px, thumb ≤ 400 px.
- **Private reads, no signed URLs / public bucket.** `<img>` can't send a bearer,
  so the client fetches photo bytes with an `Authorization` header and uses an
  object URL (`AuthedImg`). Keeps every read behind a session with zero public
  surface, at the cost of not being CDN-cacheable (fine for a 2-person app).
- **Photo-health = token heartbeat.** The Worker stamps
  `ingest_tokens.last_used_at` on every *authenticated* `/ingest` (even when the
  photo is skipped), so a silently-dying Shortcut shows a stale time. Surfaced to
  the owner via the `last_automated_upload()` SECURITY DEFINER RPC (no token rows
  leak) and a yellow >48 h warning in /settings.
- **One device token, minted server-side** (rule #7). Raw value shown once →
  `.env.local`; only its SHA-256 is stored. No UI to create more.
- **Graceful when unconfigured.** `VITE_PHOTO_GATEWAY_URL` is unset until R2 is
  provisioned; `photosEnabled()` hides the dropzone/gallery/tray so the live site
  keeps working before the human R2 step (§12c (below)).
- **Deferred to Phase 3:** unassigned photos are assigned to places manually via
  the map tray (nearest-place default); the nightly clustering job automates this.

#### 2026-07-18 — Phase 1: skeleton, schema, map, invite-only auth

- **Monorepo via npm workspaces.** `app` (Vite + React 18 + TS), `workers/*`
  (Phase 2+), `supabase/` for migrations & Edge Functions. Root scripts proxy to
  the app workspace (`npm run lint/test/build`).
- **Geography stored as generated columns.** Every spatial table keeps plain
  `lat`/`lng` doubles plus a `geom geography(Point,4326)` column
  `GENERATED ALWAYS AS (...) STORED`. The client only reads/writes lat/lng —
  avoids PostGIS wire-format handling in the browser — while spatial jobs
  (clustering, exclusion-zone, mileage) use `geom` with GIST indexes.
- **RLS baseline = "must have a profiles row to read".** Helper functions
  (`is_member`, `is_owner`, `is_editor_or_owner`) are `security definer` to avoid
  policy recursion on `profiles`. Owner-only tables: `settings`, `invites`,
  `ingest_tokens`, `deleted_hashes`. Ingest tables (`location_pings`,
  `activities`) have no client write policy — those paths use the service_role
  key server-side.
- **Invite-only auth.** Public signups are disabled in Supabase Auth. The
  `invite` Edge Function (owner-only) records an `invites` row and emails a link;
  on first login the SPA calls the `claim_invite()` RPC, which promotes a pending
  invite into a `profiles` row with the invited role. The very first owner is
  bootstrapped by hand (`supabase/seed-owner.sql`).
- **Home-exclusion zone lives in `settings`, not code.** Seeded to Leesburg, VA
  (39.1157, -77.5636) at 24140 m (15 statute miles). The client mirrors the
  Haversine math (`app/src/lib/geo.ts`, unit-tested) only to warn before a manual
  "add place" lands inside the zone; the server is authoritative at ingest.
- **Total-miles stat is a hardcoded 0.0 placeholder** with a `TODO(Phase 4)` —
  wired to summed Strava `activities.distance` once Phase 4 lands.
- **Map:** MapLibre GL + MapTiler `streets-v2` style, places as a clustered
  GeoJSON source (cluster + unclustered-point + count layers). Hover popup shows
  name, visit dates, and placeholder photo/route chips.
- **Cloudflare Pages SPA fallback** via `app/public/_redirects` (`/* /index.html
  200`) so deep links and hard reloads route correctly.

#### Prompt 2B — unified creation service + non-login people (2026-07-31)

- **`create_experience(key, place, visit)` RPC (migration 0111)** is the ONE
  transactional + idempotent creation path. A PL/pgSQL body is a single
  transaction, so place+visit+attribution+rating+people commit together or not at
  all — no half-built records. Idempotency is a client-supplied key recorded in
  `experience_requests`; concurrent same-key calls are serialized with a per-key
  `pg_advisory_xact_lock`, so a retry after a partial failure returns the SAME
  ids instead of duplicating. Rating delegates to `set_my_rating` (per-user
  `place_ratings` + owner mirror) rather than a blind `places.rating` write; a
  new visit calls `promote_trip_stops_for_place` so a planned trip stop in-window
  flips to completed. `is_trip` is a GENERATED column — never inserted (this also
  fixed a latent runtime crash in `restoreVisit`/visit-Undo).
- **Non-login people (migration 0110):** `people` + `visit_people` + `trip_people`.
  Children/companions are records, not auth accounts (owner=Erica, editor=Josh,
  viewers reaction-only). Member-read, editor/owner-write RLS; accessed directly
  via PostgREST.
- **Frontend:** `addExperience`/`newExperienceKey` + people helpers in `data.ts`.
  AddWizard and NewPlaceDraft save through `addExperience` with one idempotency
  key per action (reused on retry, reset on success); AddWizard gained a "Kids
  along" picker. Place-level `setPlaceSolo`, `website`, `review`, and additive tag
  merges remain compatibility enrichments the RPC doesn't own. PlacePanel's
  "log a visit" (submitVisit) also goes through addExperience now.
- **What deliberately does NOT use create_experience** (they aren't experience-
  logging): MapView's empty-container quick-add (blank name, `saved:false` — the
  RPC forbids blank names); MapView's trail fallback inside route-drawing
  (activity placement); DayView `moveToNew` (creates a place to *reassign an
  activity* to — the activity is the visit); PlacePanel `addSpot` (creates a
  CHILD place with `part_of` hierarchy the RPC doesn't model). These keep their
  specialized helpers by design. Bulk import remains the one genuine convergence
  debt (kept on the older path for now).

#### 2026-08-07 — Phase 1 completion, Phase 2 creation convergence, and delivery gates

**SUPERSEDES the "What deliberately does NOT use create_experience" note above.**
All five of those exceptions now DO use it. Migration `0122` extended the RPC's
place contract with the fields they actually needed — `is_trail`, `bucket`,
`needs_geocode`, `website`, `auto`, `part_of[]`, `review` — plus an explicit
`allow_unnamed` opt-in for the map's blank-name placeholder draft. The blank-name
guard stays ON by default for every other caller, so the protection the old note
cited is preserved rather than removed. `part_of` now goes through the RPC, so the
child-place hierarchy IS modelled. Because the RPC performs the same INSERT, the
existing triggers (`sync_place_category`, `sync_membership_from_part_of`,
`neutralize_junk_place`, `set_place_park`) fire identically.

- **All nine client call sites** moved from `createPlace` to `createPlaceAtomic`.
  `PlacePanel.addSpot` collapsed from THREE writes (create, then updatePlace for
  rating/review, then addVisit) to one — previously a mid-sequence failure left a
  spot with no review and no visit, and a retry created a second place.
  `createPlace` is deprecated with zero callers and an eslint
  `no-restricted-imports` rule prevents its return.
- **Truthful success.** The Add wizard mapped every failed photo upload to `null`
  and then showed an unconditional "Saved!", so a save where every photo failed
  looked identical to a complete success. Media stays outside the atomic core on
  purpose — a failed upload must not roll back a correctly saved visit — but the
  outcome is now counted and reported via a pure, unit-tested
  `saveOutcomeMessage()`. Three more silent failures fixed: visit-delete Undo
  (which left the visit deleted while the user believed it was restored),
  PlaceQuickEdit rename/retag/rate and who-went, and BucketMap add.
- **`0123`** revoked `anon`/`authenticated` table grants on `google_tokens` and
  `strava_accounts`. RLS already denied all client access, but the grants would
  have become live the moment anyone added a permissive policy — and those tables
  hold Google and Strava refresh tokens. `oauth_states` was already locked down in
  `0120`; these two were missed.

**Delivery gates.** OSV and Semgrep ran with `|| true` and therefore could never
fail. Both are now hard gates with owner/reason/expiry exception files. Semgrep was
additionally scanning a `src` directory that does not exist at the repo root, and
`MapView.tsx` only partially parses, so the largest route file was never fully
scanned while the job reported green — both now recorded rather than hidden. A new
`deploy-preview` job deploys the merge candidate to a real Pages preview and smokes
it; `release-gate` depends on it.

**Bugs that only driving the app could find.** On iPhone the place card's primary
action, "Log a visit", was 91% covered by the floating bottom nav — `elementFromPoint`
at its centre returned the Add tab, so tapping it navigated to `/add`. The build was
green and the button passed `toBeVisible()`. A live audit found the same defect on
five more routes, including `/health`'s GPX/KML/CSV export buttons. Root cause: 14
route files each repeated the same inline page wrapper reserving zero bottom space,
and because the padding was inline it beat any stylesheet rule. They now share a
`.page` class carrying `--pnav-clearance`. `scripts/audit-live.mjs` makes that sweep
repeatable.

**Accessibility.** Axe only covered `/login` and `/add`, hiding the app's largest
defect: every row checkbox on `/places` was unlabelled (183 rows, 366 nodes),
announced as a bare "checkbox" while driving a bulk, destructive tag/untag.

**Testing note worth keeping.** Two guards written this session were initially
VACUOUS — they passed with the bug present. A hit-test-only nav check passed on the
sparse disposable dataset because the card never grew tall enough to reach the nav;
and an authenticated bundle measurement reported "no heavy chunks" when an expired
token had silently redirected every route to `/login`. Both were caught by running a
negative control. **Assert the invariant, not just the symptom, and always verify a
new gate fails when the thing it guards is broken.**

#### 2026-08-08 — Place-model corrections, Slice 1: stop the nightly trip duplication

Erica reported four symptoms; all trace to three causes, and **none is covered by
any COMPLETION-PLAN phase** (Phase 6 covers trip *planning* features, not visit
derivation or the counting model). The authoritative spec, `NewClaude.md`, is
TRUNCATED — §2–§6, exactly the visit/revisit and trip sections, are collapsed into
a literal "108 lines hidden" marker — so the answers cannot be looked up.

**Approved model decisions (Erica, 2026-08-08):**
- The map badge counts **visits, not days**.
- Stays separated by **≤2 days** fuse into one visit. Cape Cod Aug 2–7 (no photos
  Aug 4) becomes ONE visit; returning next year is a SECOND visit on the SAME
  place — "count the place once, count the visits every time".
- Cape Cod becomes a **destination (region)** that counts once and holds its
  children, rather than a rollup `category='trip'` that counts zero. This matches
  the spec's own rule: *"A city is both a place you visited AND a box that holds
  other places."* Only trails and trips are non-counting rollups.
- Delete the duplicate suggestions; retire the legacy trip system.

**Slice 1 — done.** `detect-trips` re-created the same drafts nightly since
2026-07-21: 54 rows for 4 destinations. It documents itself as idempotent, but the
guard reads `places.first_visit`, which it never populates (it inserts a `visits`
row without triggering the recompute), so **all 54 rows had first_visit NULL**, the
candidate range list came back empty, and the overlap check could never match.
Dismissing was futile too: `resolveSuggestedTrip(id,false)` DELETES the row and
records nothing, so the next run recreated it.

`detect-trips-nightly` is now **unscheduled** rather than patched, because the
legacy `places.category='trip'` system it feeds is being retired and the function
must be rewritten against the canonical `trips` table. Restore SQL:

```sql
select cron.schedule('detect-trips-nightly', '30 7 * * *', $$
  select net.http_post(
    url:='https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/detect-trips',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',
             (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
    body:='{}'::jsonb) $$);
```

Do NOT restore it before the rewrite, or the duplicates return.

Cleanup was verified safe before executing: 0 photos / activities / entries /
videos / trip_stops referenced the 54 rows, and every real place referencing them
keeps its own visits. Removed 54 places, 496 junk membership links, 126 derived
container visits. places 186→132, visits 571→445, memberships 510→14; **photos 168
and activities 444 unchanged**. 24 real places became top-level — intended. Also
fixed 7 pre-existing dangling `part_of` references (that parent id was NOT among
the 54; it had been deleted long before). Zero dangling references remain.

Raw snapshot (gitignored — contains exact coordinates):
`supabase/snapshots/2026-08-08-suggested-trip-cleanup/`.

**A per-view defect found while planning Slice 3.** `visit_count` is global and not
person-aware, so the badge is identical in Just Erica / Just Josh / Both. Potomac
Station shows **67** in Erica's view though all 39 of its visits are Josh's; Lake of
the Red Rocks shows **52** in Josh's view with zero Josh visits. Slice 3 therefore
needs a per-person `place_visit_counts(p_profile)` RPC, mirroring the existing
`settings_stats(p_profile)` / `race_stats(p_profile)` pattern — not a single column.

---

#### 2026-08-08 — One outing counts once (migrations 0140–0142)

Erica's 2026-03-07 Purcellville run was stored **three times**: her Strava record
(45.1 mi), a file import of the same run (44.9), and Josh's record of the outing they
did together (44.7). The headline mileage counted all three — **134.7 miles for one
45-mile run**.

Duplicates are **grouped** on `shared_group_id`, never deleted. Every record survives
and ungrouping restores the previous totals.

**`dedupe_joint_outings` was deleting activities nightly.** It ran at 04:20 with
`delete from public.activities`, against Erica's standing rule that nothing
mass-deletes her data. It never caught this run — it only compared owner vs
non-owner and required both starts within 800 m — and was blind to same-person
duplicates entirely. Same name (the cron entry still works); it groups now.

**`wander_stats` was the only stat that didn't dedupe.** `mileage_by_person`,
`settings_stats` and `wrapped_year_miles` all did. That asymmetry is why the map's
headline total disagreed with its own per-type breakdown.

Automatic rule is deliberately tight — same type, within 20 minutes, distance within
10% — and matched only the March 7 triple. Everything looser went to Erica.

Merged with her approval: 2018-08-01 W · 2018-08-13 W · 2020-05-12 R · 2022-12-04 H ·
2023-05-24 R · 2023-05-30 R · 2023-08-01 R · 2023-08-02 R · 2025-10-04 R.
Result: Erica 2064.8 → 1950.5 mi, Josh 1048.0 → 986.3, Both 474.9 → 430.2. 444
activities before and after.

##### DATES ARE BUCKETED IN UTC — open, and it bit twice here

`start_date::date` is UTC, so any evening outing after ~20:00 ET (17:00 PT) is filed
on the **next day**. 12 activities are currently on the wrong calendar day.

* Erica: "on the 13th I only did a 4.1 and 4.7 walk — where did the other come from?"
  She was right. The 4.35 mi "San Diego walkabout" started 00:25 UTC = **17:25 local
  on 12 July**. Not a third walk on the 13th.
* She approved merging the 2024-09-03 pair; its "Evening Walk" was 00:04 UTC =
  **2 September** local. Two real walks, two different days — excluded and flagged
  back to her rather than merged on stale facts.
* It also **hid** a real duplicate: the 2018-08-13 walk crossed midnight UTC, so its
  two records sat on different days and at two different places ("Lake of the Red
  Rocks" and "Red Rock Regional Park").

Strava sends `start_date_local` and we never stored it. This drives which visit an
activity belongs to, the day view, and duplicate detection in both directions.

Snapshots are gitignored (they contain exact coordinates):
`supabase/snapshots/2026-08-08-activities-pre-dedupe.json` and
`supabase/snapshots/2026-08-08-approved-activity-merges.md`, both local only.

#### 2026-08-09 — Places know where they are, and stop being named after roads

**State/country** filled on all 36 places that lacked one, by reverse geocoding —
Erica approved this explicitly and asked that the NAME be left alone, so the update
touches `admin1`/`country` only and `coalesce` means an existing value always wins.
3 remain without a state and that is correct: Florida (resolves by longitude) and
two Barbados places (by country).

Local times were then recomputed, because `local_zone()` prefers a known state over
a longitude band — Utah is west of −112.5 but Mountain, Nevada is east of −114 but
Pacific.

**Addresses** on 90 of the 91 places that had none. Erica: "I DO want the address of
the trailhead added so I can find it easily." This is what the Directions button
reads, which is why it so rarely appeared. MapTiler prefixes `-, ` when there is no
house number; that is stripped.

**Renames.** The old geocoder named places after the street at the activity's start
point — a hike begins in a trailhead parking lot, so 14 places were called things
like Freedom Drive and Old Rag Fire Road. Renamed only where the evidence is clear,
and only where `not name_locked`, so the 60 names Erica gave are untouched:

| was | now | evidence |
|---|---|---|
| Old Rag Fire Road | Old Rag Mountain | AllTrails: 5.1 mi hike vs 5.6 mi trail, Shenandoah NP |
| Edwards Ferry Rd | Red Rock Wilderness Overlook | AllTrails: 1.0 vs 1.1 mi, 0.28 mi from trailhead |
| Freedom Drive | Reston Town Center | POI at the coordinates, 12 runs |
| Exchange Street | One Loudoun | POI, 3 runs |
| Browns Chapel Road | Brown's Park | POI, Lake Anne Village |
| Water Vista Drive | Brambleton Community Park West | POI |
| Jefferson Drive Southwest | National Mall | Smithsonian grounds, 3 runs |

**Left alone on purpose** — no confident answer, and a wrong rename on a place with
a dozen visits is worse than a bad one: Riverpoint Drive (19.5 mi longest, probably
W&OD), Isaac Newton Square, Fairway Drive, North Courthouse Road (geocodes to a
Subway), N Moore Street, North Street Northeast, Broadlands.

Renames deliberately do NOT set `name_locked` — that flag means "a person chose
this". These are machine suggestions Erica can overwrite freely.

**Method note.** Plain reverse geocoding on an activity's START point returns the
road: SR630, 211, TR408. The route MIDPOINT lands on the trail instead
("Tuscarora–Overall Run Trail", "Strickler Knob Trail"), and AllTrails on that
midpoint, cross-checked against the recorded distance, is better still. AllTrails
has no public API, so the app itself cannot call it; OSM covers trailheads for
everyone with no account.

Snapshots (gitignored): `2026-08-09-place-names-pre-rename.json`,
`2026-08-09-visits-pre-rebuild.json`.

#### 2026-08-09 — 29 activities moved to where they actually happened

Erica: "There are hikes in Elizabeth Furnace Family Campground that do not belong
there." The old importer snapped an activity to the nearest place within 30 km, so
eight hikes across three counties landed on one campground.

Each activity's real location came from its **route midpoint**, not its start point
— an activity starts in a trailhead car park, which is why geocoding the start
returns SR630, 211 and TR408 while the midpoint returns "Tuscarora–Overall Run
Trail" and "Strickler Knob Trail". AllTrails cross-checked the hikes against the
recorded distance. **Distances were never touched.**

Result: **Elizabeth Furnace 8 hikes → 0.** Activities more than 3 miles from a
non-trail place: 29 → 6, and those 6 are legitimately far (a county place, and the
Tuscarora Trail, which is linear).

Care taken while planning, because a sloppy version of this is worse than the bug:
* names cleaned of map-marker colours ("Strickler Knob Trail (pink)")
* "Strickler Knob" and "Strickler Knob Trail" recognised as one feature
* clustered on the MIDPOINT within 5 km, so two hikes at one trailhead share a
  place instead of making two
* an existing place with the same name is reused (60 km for a county/locality name,
  25 km otherwise) rather than inventing a second "Loudoun"
* a road run that geocodes to a business is not "a place we went" — "Cutt-N-Up" and
  "Oak Grove Baptist Church" fell back to the locality

15 new places created, 132 → 147 (plus one for a new hike that arrived mid-work).

##### Every new activity was leaving a place called "New place"

`place_for_activity` inserts new leaf places named literally `New place` with
`needs_geocode`, expecting the nightly geocoder to name them — but that job was
unscheduled in 0130 because sweeping every place overwrote names Erica had given.
So nothing named them. Erica's hike this morning proved it live.

`ingestActivity` now names the ONE place it just created, from the route midpoint,
and only while that place is still called "New place" and unlocked — so it can
never touch a name a person chose. strava-webhook v18 and strava-backfill v20
deployed. This morning's hike is "Camp Fraser".

#### 2026-08-09 — Step 0 of the ingest rebuild: a Strava re-sync can no longer rename an activity

`supabase/functions/_shared/strava.ts` had stopped treating `name` as a Strava-owned
field, but the *deployed* functions still did. Until this shipped, a routine sync could
put "Morning Hike" back over a name Erica had approved — and an approval system built on
top of that is built on sand. Deployed `strava-webhook` v20 and `strava-backfill` v22.

Verified by re-syncing a real activity rather than by reading the deployed code: activity
`d3f471f3` reads "Lake of the Red Rocks" while Strava still calls it "Evening Walk"; a
genuine `update` webhook event returned `{ok:true, outcome:'stored'}` and left the name
alone, while `distance` synced to 2321.3 — proving the update ran instead of no-opping.
Dataset after: 445 activities, 130 distinct names, 0 clock-reading names.

**Bug found while proving it.** Both functions called
`admin.rpc('dedupe_shared_outings').catch(() => undefined)`. A Supabase `rpc()` returns a
thenable, not a Promise: there is no `.catch()`, and failures arrive in `error` rather
than as a throw. That line raised a `TypeError` on every call — so every webhook returned
`ok:false` after the ingest had already succeeded, and the final page of every backfill
returned a 500. Replaced with the `{ error }` form and a `console.error`. The nightly
`dedupe-joint-outings` cron had been masking it, so dedup was only ever delayed to
overnight and no data was lost.

Lesson worth keeping: the failure was invisible because it happened *after* the useful
work, and the caller's own error handling swallowed the symptom into a generic
`ok:false`. Deploy-then-exercise-the-real-path caught what reading the diff did not.

#### 2026-08-09 — Ingest rebuild steps 1 and 2: the ledger, and the suggester

**Step 1 — `0148_a_machine_may_only_propose`.** `suggestions`, `approved_fields`,
`ingest_runs`, and `may_autowrite()`. Pure addition: nothing reads the guard until step
4, so it shipped the day it was written. Backfilled the locks that already existed in
four inconsistent forms — 61 `name_locked` places and 12 `manual` visits. No photo
backfill (0 of 168 photos carry a `visit_id`, so §9.3 was a no-op) and no activity
backfill, deliberately: the 328 names fixed today were machine-written, so they stay open
to a better suggestion.

`may_autowrite` is SECURITY DEFINER, departing from the design's plain SQL. A guard whose
answer depends on the caller's row visibility is worse than no guard — a caller who
cannot see the lock would be told "yes, go ahead".

**Step 2 — the `suggest` edge function.** Ports `scripts/naming/route_namer.py` to Deno.
The pure parts (`_shared/polyline.ts`, `_shared/routescore.ts`) are plain TypeScript and
are covered by the existing vitest runner via one added include path — there is no local
Deno, and shipping the scorer untested was not acceptable when a silent bug there would
poison every suggestion at once. 24 tests assert the recorded output of the prototype on
13 real routes, from the recorded tallies, so a pass cannot be an Overpass fluke.

Four judgement calls that departed from the written design, each because the design
contradicted itself or reality:

1. **Ranked list, not a winner.** "Appalachian Trail 9/9, inside Sky Meadows 8/9" is one
   hike with two correct names. The prototype had to choose; the Inbox does not, and
   choosing silently is what this rebuild exists to stop. Rank 0 only pre-selects.
2. **Total tie-breaking.** Python's `Counter.most_common` breaks ties by insertion order —
   by whatever order Overpass happened to reply in. That decided a real case (Loudoun:
   W&OD Bridle Trail 9 vs Washington & Old Dominion Trail 9). Ties now break by count,
   then longer name, then alphabetically.
3. **The geocoder fallback only fills a void.** §5.1 says fall back to MapTiler when OSM is
   silent; §5.4 says Red Rock must produce nothing. Those collide, because MapTiler will
   return a nearby town for Red Rock. Resolved by what the fallback is FOR: it runs only
   when the activity has no real name to lose.
4. **Already on one of the right answers = say nothing.** Today's hike is "Seneca Regional
   Park" because Erica corrected it herself, and the scorer ranks Potomac Heritage Trail
   (10 hits) above it (8). Offering to rename her own correction is asking her to decide
   the same thing twice. If the current name is ANY candidate, the question is settled.

**Overpass reality, measured not assumed.** The endpoint rate-limits to 2 slots PER IP and
an edge function egresses from shared Supabase infrastructure, so the first live run drew
four 504s and two 429s. Fixed by rotating independent mirrors (private.coffee answered in
1.0s while the main endpoint 504'd), a 25s hard abort per attempt, and a 110s overall
deadline that returns partial work with a `remaining` count instead of being killed by the
runtime — which is how the second attempt died, losing work it had already done.

**Verified live.** "Loudoun County Running" → rank 0 Washington & Old Dominion Trail
(7 of 9, 0.78), rank 1 the containing regional park (6 of 9), rank 2 the bridle trail.
The activity's name is UNCHANGED, `approved_fields` is untouched at 73, both runs are in
`ingest_runs`, and an identical re-run added no rows (`already_offered: 4`). Red Rock and
the Seneca hike correctly produce nothing.

#### 2026-08-09 — When both are true, the PARK wins (Erica's decision)

Asked because "Appalachian Trail 9/9, inside Sky Meadows State Park 8/9" is one hike
with two correct names. Erica: "go with the park." Implemented in `scoreRoute`: a park
clearing 40% of samples takes rank 0; a trail wins only when no park qualifies. This
sets which option is PRE-SELECTED — the trail is always offered at rank 1, one tap away.

A consequence worth having seen: the W&OD now defaults to "Washington & Old Dominion
Trail Regional Park" rather than the trail she actually calls it, and a long
point-to-point on the AT will default to whichever park that particular hike crossed.
Both remain one tap from the right answer, and step 7 (`naming_rules`) is what makes a
per-area preference stick permanently.

#### 2026-08-09 — Step 3: the Inbox

Migration `0149`: `approval_undo`, `apply_inbox_field`, `inbox`, `inbox_counts`,
`approve_card`, `reject_suggestion`, `undo_approval`, `clear_approval`. Route `/inbox`,
`app/src/routes/Inbox.tsx`, `app/src/lib/inbox.ts`.

- **approve_card is one transaction.** A stale option raises rather than approving half
  a card — a name written without its lock is the exact state this design prevents.
- **Undo restores the values AND removes the locks.** Either alone is not undo.
- **No `skip_card` RPC.** Skipping writes nothing by definition, so it is client-side;
  the card returns on the next load. An RPC that does nothing is a thing to maintain.
- **`apply_inbox_field` uses an explicit CASE, not dynamic SQL.** The set of fields the
  Inbox may write is small and fixed and worth stating out loud; anything else raises.
  Changing an activity's place rebuilds stats and visits at BOTH ends.
- **The Inbox nav tab appears only when something is waiting.** Six permanent tabs do
  not fit a 320px phone. Settings-side entry still needs adding.
- **Step 8 folded in:** `© OpenStreetMap contributors`, linked, visible without
  interaction, on the screen where OSM names are shown. That compliance gap is closed.

**A real bug caught only by driving it.** The app's global input styling is
`display:block; width:100%`, which is right for text fields and very wrong for a radio:
the dot rendered **238px wide**, collapsed the label beside it to zero width, and pushed
the row off a 320px screen (`scrollWidth` 386 vs 320). Typecheck, lint and unit tests
were all green throughout — only measuring the real page at 320px found it. Fixed by
pinning the radio to 16px.

Verified on the deployed build: the card reads "Loudoun County Running", offers the park
(contains 6 of 9 route points) pre-selected with the trail at rank 1, evidence in words
on every option, "Looks right" / "Skip", nav shows "Inbox 1", no console errors, and no
horizontal overflow at 320px.

#### 2026-08-09 — Step 4: the machines go behind the guard

Migration `0150`. Steps 1–3 built the ledger, the suggester and the Inbox; until this,
the rule only bound code that opted in.

**Group 4.1 — person-initiated (write AND lock).** `set_place_name`, `update_activity`,
`reassign_activity`, `set_visit_place`, `set_visit_is_trip`, `set_photo_visit` now call
`record_approval(...)` with `via='edit'`. Her edit in the app IS the approval, so the
Inbox never asks about something she has already decided. One deliberate subtlety:
`update_activity` records an approval only when a NAME was supplied — a type-only fix
("this was a Ride, not a Run") must not silently end all future naming of that activity.

**Group 4.2 — the one that could actually undo an approval.**
`rename_activities_for_place` rewrites every generic name at a place whenever that place
is renamed. Its only protection was `is_generic_activity_name()`, which cannot tell a
name Erica chose from a previous guess. It now also requires
`may_autowrite('activity', a.id, 'name')`.

**The inventory was taken from the LIVE function bodies, not the design's list**, and it
changes the conclusion. The design named ~13 machine functions to guard; on inspection
most cannot overwrite a decision at all:

- `import_file_activity`, `cluster_unassigned`, `ensure_visit` place things that were
  never placed — there is no prior decision to overwrite, and guarding an INSERT is
  meaningless.
- `merge_places` / `merge_places_auto` repoint rows off a place being merged away.
  Refusing per-activity would strand them on a place that no longer exists, which is
  worse than what the guard protects against.

So one function needed the guard, not thirteen. Saying that plainly is better than
mechanically wrapping twelve functions to make a checklist look complete.

**The test is the deliverable.** `supabase/tests/0150_machines_behind_the_guard.test.sql`
reads EVERY function body, splits statements, examines only the part of an `UPDATE`
between `set` and `where` (so a field named in a WHERE clause is not mistaken for a
write), and fails if anything outside a reasoned allowlist writes an Inbox-owned field
with neither an approval nor `may_autowrite`. Every allowlist entry carries its reason.

Two blocks exist to stop the test lying: one plants a deliberately rule-breaking
function and requires the scan to catch it (a test that cannot fail proves nothing), and
one asserts every allowlisted person-initiated function really does call
`record_approval` — otherwise allowlisting them would be an unchecked assumption.

Verified on prod in a rolled-back transaction: 6 blocks pass, `approved_fields` back to
73, 445 activities, 0 clock-reading names, no fixtures or planted functions left behind.

#### 2026-08-09 — Step 6, run bounded on purpose

Swept 24 of the 80 weak-named activities ("Loudoun County Running" ×76, plus a few
county/township names) through the scorer. **Bounded deliberately:** sweeping all 80
would have put ~76 cards in Erica's Inbox unannounced, and step 7 (`naming_rules`,
"stop asking after the 3rd identical approval") is the thing that exists to prevent
exactly that. Better to prove the gate on a sample and let her choose.

**Gate met.** 7 cards / 20 options pending. `suggestions` on locked places: **0**.
Suggestions proposing the name the activity already has: **0**. Activities still 445,
0 clock-reading names, `approved_fields` still 73 — nothing was written.

Real improvements found: `Loudoun County Running` → *Washington & Old Dominion Trail* /
*W&OD Railroad Regional Park* (9 of 9 on one route), and one → *Battlefield Parkway
Trail*. 17 produced NOTHING, correctly: suburban neighbourhood runs with no named OSM
trail or park, where the geocoder is deliberately not consulted because the name is not
generic and there is a real name to lose.

**The park-first rule, visible in her own data.** On activity `1f175094` the trail
scores 7 of 9 and the park 5 of 9, and the PARK is still pre-selected with the
higher-scoring trail at rank 1. That is her decision working as specified, and it is
what step 7 will let her flip permanently for a given area.

**Overpass from Supabase egress is genuinely unreliable:** 19 transport failures
(4×429, 5×504, 10 network) across 24 activities even with three mirrors and retries.
Failures cost nothing — nothing is written and the activity is simply re-offered later
— but a full sweep belongs in a nightly job that retries, not a foreground request.

#### 2026-08-09 — Step 7: it learns what you call a place

Migration `0151`: `naming_rules`, `rule_offer`, `learn_rule`, `forget_rule`,
`apply_naming_rule`, `naming_rules_list`. The Inbox offers "Always call them that?"
only after the SAME name has been approved for the SAME area **three** times — twice
can be coincidence, three times is a habit.

**The safeguard that makes automation acceptable here.** Applying a rule writes the
name AND an `approved_fields` row (`via='rule'`) AND a `suggestions` row
(`status='approved', source='rule'`) whose label reads "Called it X because you always
do here", carrying the rule id, radius and how many approvals taught it. Silent
automation caused everything this rebuild is fixing; this is automation that shows its
working and can be undone by the ordinary `clear_approval`.

**Her decision outranks her own rule.** `apply_naming_rule` calls `may_autowrite`
first, so a name she chose is never replaced by a rule she made earlier. Tested.

The suggester now checks for a rule BEFORE reaching for Overpass, which both stops the
asking and saves a call on the endpoint that fails most often.

Tests (`0151_...test.sql`, 7 blocks, all with controls): offers on a habit but not a
coincidence; applies and leaves both the lock and the audit row; **does not reach past
its radius**; **does not overwrite a name she chose**; stops offering once learned;
`forget_rule` really forgets; non-members read no rules.

Deliberately NOT done: no rule was created on her data, and no card was approved on her
behalf. Those are her decisions, and the offer only appears once she makes three.

#### 2026-08-10 — The nav pill: fit six, and make the highlight mean something

Erica: "the inbox pill is half off the screen and the highlight should be the brighter
blue that was on the add choice previously."

**The highlight.** `.pnav-tab.active` used `--accent-soft` — a 16% wash that was too
faint to read as a selection. It is now the filled `--accent` (#3b82f6) with white
text: the bright fill Add used to carry permanently, moved onto whichever tab you are
actually on.

**The clipping.** Six tabs did not fit, and `overflow-x: auto` on the pill turned that
into a tab cut off at the pill's edge — which is what "half off the screen" was. Tab
padding/font now step down at 470px and 380px so six fit at every width we target;
measured 320-430px with the worst-case label ("Inbox 12"): nothing clipped, no page
overflow.

**The Inbox tab is now permanent.** Hiding it when the queue was empty had a second
bug: `/inbox` then highlighted no tab at all. Only the count comes and goes.

#### 2026-08-10 — Step 5: photos from that day

Migration `0153`. All 167 live photos were unpinned. A photo suggestion is just a
suggestion with `subject_type='photo', field='visit_id'`, so it inherits approval,
locking and undo for free — the payoff for building the ledger generically in 0148.

`propose_photos()` matches an unpinned photo to the NEAREST visit whose date range
contains the photo's **local_date**, within 5 km. `local_date`, not `taken_at`: a 9pm
photo must not land on the next day. One proposal per photo — offering the same photo
to three visits is a question with no good answer.

**Photo cards are their own cards** (`group_key = 'visit:<id>'`) rather than being
bolted onto activity cards: a visit is what a photo attaches to, one card can offer a
whole day at once, and activity naming stays untouched. `inbox()` now returns both
shapes, reading the subject from the group_key prefix because a photo card has many
subjects. `approve_card` gained an optional `"photos": [...]` — still one transaction,
one undo token. Unticked photos are **superseded, not rejected**: she passed this time,
she did not say the photo never belongs there.

First run proposed 20 across 12 visits, and the groupings are obviously right:
San Diego 4 (0 m), Cape Cod 3, Paynes Bay 3, Sunset Cliffs 2. Nothing was written —
0 photos pinned, 0 approvals.

**A date bug caught by reading the screen against the database.** The card said
"Monday, July 13" for a visit the database records as **2026-07-14**. A date-only
string parses as UTC midnight, which renders as the previous day west of Greenwich —
the same class of bug migrations 0143/0144 fixed server-side, reintroduced in the
client. `dayLabel` now parses `YYYY-MM-DD` as a local date. Verified against the DB:
Fort Rosecrans 07-14, Cape Cod 08-02, San Diego 07-11 all now read correctly.

#### 2026-08-10 — Offline mode, re-enabled safely

The service worker was ripped out once because a cached shell served old code and
blocked updates, leaving the app with no offline mode. Re-enabling it required fixing
the reason it failed, not just turning it back on.

**The old worker cached everything the same way, including index.html.** A stale
index.html points at hashed assets that no longer exist — the white-screen failure.
The new one splits by kind:

- **Navigations / HTML — network first, always.** Cache is only an offline fallback,
  so stale HTML online is impossible.
- **`/assets/<hash>.*` — cache first.** Vite content-hashes these, so a URL's bytes
  can never change; caching them forever is the definition of the file, not a risk.
- **Cross-origin — untouched.** Supabase, the photo gateway and MapTiler are other
  origins, so private photo bytes and authed API responses are never written to a
  cache. Rule #8 holds by construction. **Verified: 0 cross-origin cache entries.**

**A kill switch, because the fear was well earned.** `adventureorno.com/?sw=off`
unregisters the worker, clears every cache, remembers the choice and reloads; `?sw=on`
restores it. The reload matters: clearing caches while the old worker still CONTROLS
the page loses the race — it services a fetch and re-caches it, which left a cache
behind in testing. Verified end to end: 0 registrations, 0 caches, flag dropped.

**The offline message is stall-based, not `navigator.onLine`-based.** With the network
cut, Chromium still reported `onLine === true`; captive portals lie the same way. A 6s
timer measures what actually matters — nothing has arrived — so the message is honest
whether the cause is offline, a portal, or a dead backend. Both loading gates (the auth
check and the lazy-route Suspense fallback) use it.

Verified on production: registered, controlling, caches `aon-shell-v4` / `aon-assets-v4`,
6 nav tabs, no page errors; offline, the shell boots from cache and explains itself.

#### 2026-08-10 — The authz matrix, and the two gaps it found

The backlog called this "pgTAP authz matrices". **pgTAP is available (1.3.3) but was
deliberately not installed:** it puts ~200 functions into a PRODUCTION database purely
so a test can say `ok()` instead of `raise exception`, and these tests already run
against production in a rolled-back transaction because there is no local Docker. The
grid is the deliverable; the framework is not.

`supabase/tests/0154_authz_matrix.test.sql` asserts eight invariants: every public
table has RLS; anon holds no table grant; the token tables are service-role only; the
ledger is member-readable and client-unwritable; no table is reachable with zero
policies; a signed-in non-member reads nothing anywhere; a member reads through the
same policies (the negative control, so test 6 cannot pass on empty tables); and no
SECURITY DEFINER function is anon-executable.

**It failed on first run, twice, and both were real.**

1. **`anon` held SELECT/INSERT/UPDATE/DELETE grants on ~35 tables**, including
   `settings`, `ingest_tokens`, `deleted_hashes` and `parks`. No data was exposed —
   every policy is `to public` with an `is_member()` predicate, so anon was refused by
   the predicate. But it left one correctly-written USING clause, forever, as the only
   thing between the anon key (which ships in the client bundle) and the data. 0093
   made exactly this argument for functions and revoked EXECUTE from anon on all 83
   SECDEF ones; tables were never given the same treatment. Now revoked, plus
   `alter default privileges` so the next `create table` cannot silently re-open it.

2. **The ledger was writable by `authenticated` at the grant layer** — and that one was
   mine. 0148/0149/0151 each did `revoke all … from public, anon` then granted SELECT.
   That is not enough: Supabase's DEFAULT PRIVILEGES give `authenticated` its own
   direct grant of ALL, and revoking from PUBLIC does not touch a role's own grant.
   RLS still refused the writes (SELECT policy, no write policy), which is exactly why
   the 0148 test passed — an RLS refusal and a missing grant both raise 42501, and that
   test could not tell them apart. An audit trail should not rest on a single policy.

Two exclusions, both stated in the test rather than hidden: `spatial_ref_sys` (PostGIS
EPSG reference data, not ours to re-grant) and extension-owned functions (PostGIS ships
`st_estimatedextent` as SECDEF and anon-executable; it reads planner statistics for a
table the caller can already see).

Verified afterwards that nothing broke: the login page still renders for anon, and a
member still reads the Inbox (12 cards) and Places (149 rows) with no page errors.

#### 2026-08-10 — The accessibility pass, and retiring an allowance

Axe (WCAG 2.0/2.1 A + AA) across /login, /inbox, /timeline, /places and /settings found
exactly one violation, and it was one I had just introduced: the active nav pill.

Erica asked for the bright accent fill on whichever tab you are on. White on `--accent`
(#3b82f6) at 12-13px bold is **3.68:1**, below the 4.5:1 AA requires for text that size,
and axe flagged it as serious on every authenticated page. The nearest passing blue to
hers is #396ef0 at exactly 4.50:1 — too close to the line to rely on — so the pill now
uses a new `--accent-strong` (#2563eb, **5.17:1**). `--accent` is unchanged, so nothing
else in the app shifted; the pill still reads as the same bright blue.

**The allowance is gone.** `e2e/a11y.spec.ts` carried a rule-wide `color-contrast` entry
in ACCEPTED_SERIOUS with a note to "retire it once a run is green without it". A
rule-wide allowance also hides unrelated findings — that same entry would have
swallowed any new contrast bug anywhere in the app, including this one. ACCEPTED_SERIOUS
is now empty, and the comment says an entry may come back only for a decision.

`/inbox` was added to the scanned routes: it is the newest surface and has the most
controls per card — radio groups, a free-text alternative, per-option "Never", and photo
checkboxes. **17/17 pass** (8 routes × 2 viewports, plus the place-row checkbox naming
test) with nothing accepted.

#### 2026-08-10 — CI caught four things production testing structurally could not

Runs 75–82 failed on the feature branches. **None of them deploy** — they are
`pull_request` events, and the production job only runs on push to `main` — but the
failures were all real, and one of them was already live because I had been deploying
by hand with `wrangler pages deploy --branch main`, which bypasses CI entirely.

**1. A live UI regression: the nav covered the map's zoom buttons.** Adding the sixth
(Inbox) tab widened the pill until, on a phone, it sat on top of `Zoom in` / `Zoom out`.
`e2e/nav-obstruction.spec.ts` hit-tests rather than trusting `toBeVisible()`, which is
the only reason it was caught — the buttons were visible, just untappable. The pill is
centred and at most 348px, so it can only reach the controls below ~450px of viewport;
`.maplibregl-ctrl-bottom-*` now lifts by `--pnav-clearance` there and desktop is
untouched. 10/10 that spec now passes.

**2–4. Three of my own SQL tests asserted PRODUCTION numbers.** CI applies the
migration chain to an empty disposable database, where "61 locked place names" and
"a member sees more than 0 places" are both wrong — so they passed against prod and
failed in CI, which is the opposite of useful. A test that only holds against one
database is measuring the database, not the code. 0148 now asserts an invariant (every
locked place has a recorded name decision) instead of a count; 0154 creates its own
fixtures for the negative control. 0151 was simply stale: 0152 replaced
`apply_naming_rule(uuid)` with the two-argument form, and the test still called the old
signature — so it also gained a block for the behaviour 0152 exists for (a rule must not
apply when the route disagrees, and silence is not agreement).

Fixing 0148 surfaced one more thing worth writing down: inserting a named place trips a
trigger that sets `name_locked`, so the test's own fixtures were locked-without-approval
by construction. The invariant is about data that predates the transaction, and now
says so.

**The lesson, plainly:** running SQL tests only against production in a rolled-back
transaction is not equivalent to running them against a fresh database, and deploying
by hand is not equivalent to shipping through CI. Both gaps hid real defects.

#### 2026-08-10 — Phase 0: one planning document, and the Appalachian Trail

**Six competing "what to do next" documents became one.** ~40 markdown files, ~380 KB,
of which COMPLETION-PLAN (41 KB), CLAUDE-CODE-INSTRUCTIONS-2-70 (58 KB), NewClaude
(52 KB), CLAUDE.md's backlog (29 KB), RESUME-HERE (15 KB) and INGEST-BUILD-PLAN all
claimed to say what to do next. Every session picked a different one, which is the
mechanical reason Erica kept re-asking for the same work.

`docs/STATE.md` is now the only planning document: what the app is, the one model
(place → visits → the day), the single Edit page that absorbs add/import/ingest/sort/
edit/organize/delete/fix, the five remaining phases, a register of things removed **on
purpose** with the commit to restore them, and the facts that must not be relearned.
Everything else moved to `docs/archive/`, whose README says plainly that it is history.
CLAUDE.md now points at STATE.md rather than the archived COMPLETION-PLAN.

**The Appalachian Trail.** Erica: "the appalachian trail no longer exists in Places…
why do segments of it appear?" It was never deleted — `app/src/lib/data.ts:443` filters
out anything with `holds_children`, so every container (AT, Tuscarora, W&OD, trips,
cities) vanished while its sections remained. A stats rule ("containers don't count
twice") had leaked into visibility. Fix is Phase 2.

The card also renders one row per outing, so "Maryland Heights" appears nine times
rather than once with nine dates. Her instruction — section listed once, opening to its
dates, dates opening to the card — is the Sections shape applied everywhere.

**"downtown Leesburg, VA" — approved for deletion, and NOT deleted.** She approved it on
my report that it had 0 activities. That was true but incomplete: it also holds **3
photos and 2 visits**. It is a real place she has been; it simply is not on the
Appalachian Trail. Removed the membership row only, so the trail is correct and nothing
of hers was destroyed. Flagged for her to decide whether the place itself should go.

Decision recorded: **the map goes straight to self-hosted** (Protomaps pmtiles in R2
behind a Worker), not a proxy first. Nobody outside can suspend it, and it is the only
version that scales commercially.

#### 2026-08-10 — Phase A at Places: a container is what it holds

**Places lists each container once, holding its sections.** The list was 148 rows,
flat and alphabetical, with the Appalachian Trail sitting between its own sections.
Now a container is a row that opens to its sections, each listed once, and a section
is not repeated at the top level. Nothing is hidden: every place is still in the list,
and searching flattens it so a match can never hide inside a collapsed container.

**A container is a place that HOLDS other places — not one carrying the
`holds_children` flag.** The flag is wrong in both directions: it is set on 15 places
that hold nothing (Reston, Seattle, Cape Cod, Rehoboth Beach…) and unset on Leesburg,
which holds North Street Northeast. Reading the flag was also hiding data — a "rollup"
shows fused visits and no activity rows, so the 8 outings logged on Reston, Seneca
Rocks, Shockey's Knob, Claytor Lake and Virginia Beach were invisible on their own
cards. They are back.

**Sections are listed once and open to their dates.** The trail card poured every
section's outings into one flat list — `fetchActivitiesForPlaceTree` returns the whole
tree — so "Maryland Heights" appeared nine times instead of once with nine dates. A
section now shows its name, its most recent date and a text control reading "9 dates";
opening it gives the dates; a date opens the day card. That is Erica's shape —
container → section → dates → the day — and it now applies to cities, regions and
trips too, not only trails. The same decision retires the second listing: a city's
places appeared under NOTES AND REVIEWS *and* would have appeared here.

**The trail's own 32 days were not being shown at all.** `visitRows` was
`isTrail ? [] : …`, so a trail card listed activities and nothing else — and 32 of the
AT's days are photo days with no Strava activity. A trail is a place you went; the
days you went are its dates.

The rules that decide all of this now live in `app/src/lib/containers.ts` with 11
tests built from the real Appalachian Trail: the container is listed once, sections
nest under it and not beside it, nothing is dropped, a day with a visit and a hike is
ONE date with the hike on it, and a section's list never contains the container's own
outings.

**"downtown Leesburg, VA" was still on the Appalachian Trail** — six days after she
approved removing it. Only the `place_membership` row was deleted, and membership is
not the record: `places.part_of` is, and `sync_membership_from_part_of` rebuilds the
table from the array on the next update of that place. So the card still showed it and
the row would have come back on its own. Migration `0155` removes it from `part_of`,
which removes it from both. The AT now has 6 sections; the place keeps its 3 photos
and 2 visits and is simply a place again.

That is the fourth instance of one fact having two mechanisms and the UI reading the
wrong one — after `part_of` vs the card, `counts_as_place` vs the Places filter, and
the park name vs `places.park`. The pattern is worth naming: when a value is derived,
write the source and read the source.

**Card wording.** "+ Add a place here" and "+ Add existing places" read as the same
button twice, and only one of them adds a place — the first opens the note/review
editor. They now say "+ Write a note or review" and "+ Put a place inside this one".

Also fixed on the way past: `fmtRunDate` was given date-only strings (`first_visit`),
which parse as UTC midnight and render as the previous day west of Greenwich. It now
parses `YYYY-MM-DD` with local components itself.

#### 2026-08-10 — Shipped, and two things that block shipping

Phase A at Places is live on adventureorno.com (deployment `c1d74e34`). Verified on
production: Places lists 129 top-level rows with 9 containers, the Appalachian Trail
reads "6 sections", its card reads SECTIONS (6/6 visited) with Maryland Heights as ONE
row of "13 dates", and the two add buttons say what they do.

**GitHub Actions is out of budget, and that is what stopped the automated deploy.**
Every required job passed on the merge candidate — build, e2e, db-tests, security,
semgrep, osv-scan, deploy-preview — and then `release-gate` failed with ZERO steps and
no log. The annotation, which is only visible through the check-runs API, says:

> The job was not started because recent account payments have failed or your spending
> limit needs to be increased.

`release-gate` is the last job in the run, so it is the one that runs out. Because
`deploy-production` depends on it, **production cannot deploy from CI until the billing
is fixed** — and the failure looks like a code failure unless you fetch the annotation.
This deploy was therefore done by hand, against a commit CI had already gone green on.
That is the exception, not the rule; the moment billing is restored, deploys go back
through CI.

**A deploy leaves a ~2 minute window that poisons browser caches.** Between the custom
domain serving the new `index.html` and the new assets propagating to it,
`/assets/index-<hash>.js` returns the SPA fallback — HTML, with a 200. `_headers` marks
assets immutable, so a browser that loads the site in that window caches a text/html
response for an immutable URL and keeps showing an unstyled, broken page until a hard
refresh. Observed live, and it is exactly the "white dots" Erica has reported before.
Verify against the deploy-hash URL (`https://<id>.adventureorno.pages.dev`), which is
never in that window, and always tell her to hard-refresh.

#### 2026-08-10 — The map is back, and MapLibre 6 was half the reason it was gone

Erica: "I like the OpenStreetMap and Mapbox that Snapchat uses." The basemap is now
Mapbox — with a token that already existed in `.env.local` and had never been used for
tiles. Chasing it down took four wrong turns, all worth writing down.

**1. The CSP blocked Mapbox.** `connect-src` allowed api.maptiler.com and not
api.mapbox.com. Which also means the Mapbox POI search — wired up weeks ago — had been
silently blocked for its entire existence.

**2. A Mapbox style is not a MapLibre style.** It carries `projection: {name: "globe"}`
(MapLibre spells it `type`) and a `fog` block MapLibre does not implement, whose colours
are black. MapLibre throws "unknown property" on the first; with validation off, you get
a black rectangle with correct attribution over it.

**3. So the basemap is RASTER tiles now.** Mapbox serves any style as raster, every
renderer handles those, and it needs no `mapbox://` rewriting and no copy of their style
document. Labels are baked into the image — irrelevant here, where every marker is a
photo drawn on top.

**4. And then the markers still did not appear — because MAPLIBRE 6 BREAKS EVERY
WORKER-BACKED SOURCE.** Vector tiles never arrived; `isSourceLoaded` stayed false
forever; no error event ever fired. Reduced it to a MapLibre map with ONE GeoJSON point
and one circle layer: same silent nothing. Raster tiles work because they are decoded on
the main thread. That single fact explains all of it — the app's places, clusters,
routes, fog and heat are all GeoJSON, so **the entire map contents were broken**, and it
was invisible because the basemap was already dead from MapTiler.

Reverted to MapLibre 5.24, which is what CLAUDE.md pins as the stack; 6 was a dependency
bump this morning, not a feature we needed. On 5, the same build renders 23 markers and
the two people. **Do not upgrade to MapLibre 6 without opening the map and counting
markers** — a green build and a clean console both lie about this.

**The tile budget.** Through MapLibre, Mapbox bills per tile REQUEST, not per map load —
the exact shape of the MapTiler blowout. `lib/basemap.ts` now meters every tile against
30,000/day per browser, warns at half, and refuses beyond it. During this session's
debugging the meter read 2,653 in a few minutes while the idle globe spin was running,
which is precisely the runaway it exists to catch.

#### 2026-08-10 — Where we are

The Snap-Map feature, built on data that already existed: 16,988 pings for Erica, 14 for
Josh. That gap IS the feature's honest limit — a web app gets no background location on
iOS, so a ping only lands while the app is open.

So it reports LAST SEEN, never "live": each person's most recent position as a photo
marker (their latest photo — every marker here is a photo), labelled with its age, and
dimmed once it is more than a day old. `ageLabel` goes deliberately coarse past an hour,
because "677 minutes ago" claims a precision the data does not have.

Ghost mode (`profiles.share_location`, migration 0156) hides you from the other person
while you still see yourself, so the switch is legible. `last_seen()` is member-gated and
anon holds no EXECUTE, like every other SECDEF function here.

Verified on production: "Erica · 3 hours ago" on the map, with her photo as the marker.

#### 2026-08-11 — One plan, and a build that refuses to lie

**Every document that competed with STATE.md is deleted** — README.md, docs/archive/
(18 files), docs/adr/, CLAUDE.md's backlog ledger and Spaces proposal, NewClaude.md,
CLAUDE-CODE-INSTRUCTIONS-2-70.md, and the plan-shaped memories. ~380 KB of "what to do
next", which is the mechanical reason the same work kept being re-requested: every
session picked a different one. All recoverable from git history. The unshipped items
were read out of them first and folded into STATE.md §5.

**The build now refuses to produce a silently broken bundle.** `VITE_*` values are baked
in at build time, so an empty one becomes "undefined" in the bundle and its feature just
goes — no error, no log. That is how `VITE_GOOGLE_CLIENT_ID` disappeared. A Vite plugin
now fails the build without the Supabase URL and key, or without at least one map source
(with neither, every map is blank — and a blank map hides the places, routes and fog
drawn on it). Optional integrations stay optional: the photo gateway, Strava and Google
hide themselves honestly.

Verified by blanking each variable and watching `npm run build` exit 1 with the name of
what is missing, then restoring and building clean.

**A correction to the audit.** I first recorded that Cloudflare Pages holding no env vars
meant a Cloudflare-side build would ship a blank bundle. Checking the API rather than
assuming: the live project `adventureorno` is **direct-upload only** — no git source, no
build command — so it never builds and the missing vars are harmless there. The real
finding is a SECOND project, `adventureorno-com`, connected to GitHub with an empty build
command, serving only its own pages.dev. It is a leftover, and the "Cloudflare Pages"
check on every PR points at IT rather than at the project serving the site.

#### 2026-08-11 — CI moved to Cloudflare, because the GitHub bill is not being paid

Erica: "I am not upgrading my gh plan so find a way to deploy CI another way."

**Cloudflare Pages builds from git on its free tier, and the build command is the gate:**
`npm ci && npm run lint && npm run test && npm run build`. A failing test or a lint error
fails the build, and a failed build does not deploy — which is the same guarantee
`release-gate` was giving, without GitHub Actions minutes. Verified on a real build:
eslint + prettier, 88 app tests, 20 worker tests, then Vite. The bundle it produced is
**byte-identical** to the one deployed by hand (`index-BiduceMY.js`), which is the
strongest evidence the pipeline is honest.

Cloudflare now also holds every `VITE_*` plus `NODE_VERSION=22`, on both projects and
both environments — without them a Cloudflare build would have produced a bundle with no
Supabase keys and no map token. The Vite assertion added this morning would now catch
that anyway, and it did: it ran inside the Cloudflare build and passed.

One thing left, and it is outward-facing so it waits for her word: the custom domain still
points at the OLD direct-upload project, so this pipeline publishes to
`adventureorno-com.pages.dev` only. Moving the domain makes it the real deploy path.

#### 2026-08-11 — The planet, and what it actually costs

Erica wants the whole planet self-hosted. The numbers, all verified rather than
estimated:

- The Protomaps daily planet build for 2026-08-10 is **137,281,886,877 bytes = 137.3 GB**,
  zoom 0–15, and it answers HTTP range requests (206, `PMTiles` spec v3).
- In R2 that is **≈ $1.91/month** of storage after the 10 GB free tier, and **$0 egress** —
  R2 does not charge for it. Reads are Class B ops at 10M/month free; two people cannot
  approach that. **≈ $2/month, flat.**
- Against that: Mapbox through MapLibre bills PER TILE REQUEST, which is the exact shape
  of the blowout that lost us MapTiler.

**And 137 GB never touches Erica's machine.** The source is served from Cloudflare and R2
is in Cloudflare, so a Worker copies it range-by-range as a multipart upload and the bytes
stay on their network.

**Snapchat, for the record, does NOT self-host.** Snap Map is Mapbox — a partnership since
2017, Mapbox Outdoors plus Mapbox Satellite, OpenStreetMap underneath. The look she likes
is Mapbox+OSM; Snap pays for it at enterprise scale. Self-hosting is the opposite trade,
and it is only open to us because Protomaps publishes the same OSM planet as one file.

The blocking step is hers: **an API token with R2 read+write.** Nothing in `.env.local`
can touch R2 — the photo Worker gets there through a binding, not the API.

#### 2026-08-11 — Virginia Beach reads as three visits, and why that is a rule problem

Erica: "VA Beach now has 3 visits because the picture was not the same date as the visit,
which was in march for the race."

She is right, and the cause is structural rather than a one-off. `rebuild_place_visits()`
derives visits from photo dates, ping dates, activity dates and entry dates and **writes
them as visits**, deleting and recreating them on each run unless `manual = true`. At
Virginia Beach the real event is the Yuengling Shamrock Marathon on **22 Mar 2026**;
photos dated **3 Mar**, **4 Mar** and **20 Jul** each became a visit of its own.

The July one is the tell: its `taken_at` is exactly `12:00:00` and it was created the day
BEFORE that date — a placeholder, not EXIF. **34 of 176 photos carry a noon placeholder**,
so photo dates were never a safe thing to derive a visit from.

**This contradicts STATE.md §2 directly** — *a machine may only propose; a person's
decision writes, and it is permanent* — and §10 (the data model, below) documents the rebuild as
intended, so the two documents disagree. **476 of 488 visits are machine-derived and
rebuildable; 12 are protected.** Recorded in STATE.md §4 as the biggest open conflict in
the repo. Not fixed yet: the fix changes how visits work everywhere and needs her
decision.

**And the photos are not lost, they are unpinned.** 156 of 176 photos have no `visit_id`,
which is why they do not appear on a visit card — the card can only show what is attached
or date-matched. The photo-suggestion machinery from migration 0153 exists to pin them and
has never been run to completion.

**"We built ALL of this already, where did it go?"** — it is all still there, just placed
differently from what she wants:
- The full-screen carousel exists, with the date and the heart / fire marks.
- The reactions live ONLY inside that lightbox, not on the card.
- The place card groups photos into one carousel PER VISIT, so she sees several strips
  rather than the single carousel she asked for.
Nothing was deleted; the arrangement is wrong. Recorded as direction 5.

#### 2026-08-11 — A decision is permanent, by construction

Erica: "all manual work I do should overwrite machine work, and should not be undone by
anything. We set this rule yesterday and then it was ignored... Figure this out since it
keeps happening."

**Why it kept happening.** The rule was enforced by REMEMBERING to set `visits.manual`,
and three writers did not: `set_visit_solo` (who was here), `set_photo_visit` (pinning a
photo) and `ensure_visit`. Meanwhile ELEVEN functions call `rebuild_place_visits`,
including `visits_sync_photo` — a trigger on the photos table. So the loop was:

  add a photo → trigger → rebuild → delete every visit not marked `manual`
    → photos.visit_id is ON DELETE SET NULL → her pins silently vanish
      → the freed photo's date seeds a new visit

That is 156 of 176 photos unpinned, and Virginia Beach showing three visits for one race.

**The fix is structural, so it cannot be forgotten again** (migration 0157):
1. A trigger marks a visit decided whenever a SIGNED-IN PERSON changes its dates, note,
   attribution, trip flag or status. `auth.uid()` is non-null only for a real user's
   request — cron and edge functions run as service_role with no uid — so the machine
   path is untouched and no future setter has to remember anything.
2. Pinning a photo marks that photo's visit decided, for the same reason.
3. The rebuild will not delete a visit that holds pinned photos, even an undecided one.
4. A pinned photo no longer seeds a day of its own: it belongs to its visit whatever its
   date says. That is Erica's rule verbatim — "if I add a photo to a visit, it should
   remain with that visit regardless of the date".
5. Backfill recognised the decisions already visible in the data (pinned photos,
   overridden attribution): protected visits went 12 → 31.

**Proven, not assumed.** Replayed the destructive case inside a rolled-back transaction:
an unprotected visit holding a pinned photo survived `rebuild_place_visits` with its photo
still attached. Before 0157 the visit would have been deleted and the pin nulled.

One process note: an early version of that test left a transaction open without a
rollback and did insert a row; the Management API discarded it when the statement failed
(verified: 488 visits, none on the test date). Explicit `begin/rollback` from now on.
