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

## 2. THE SYSTEM — LOCKED, 2026-08-11

> Erica: *"Make sure you understand it and everything in STATE.md, memory, and history
> understands the system — by system, I mean the way that visits and places are recorded and
> statistics are gathered. I DO NOT WANT TO KEEP REBUILDING THIS."*
>
> **This is the definition. Everything — schema, RPCs, stats, cards, memory — answers to it.**
> If code disagrees with this section, the code is wrong.

### The three nouns

**PLACE** — somewhere she has been. **Counts ONCE in Places**, however many times she goes.
Adding a place is already its first visit.

**VISIT** — **one date, or one set of dates.** Never a scattered collection. **Counts every
time.** A second visit to the same place makes it *a place visited twice*; it does not make a
second place.

**ACTIVITY** — a hike, ride, walk or run. **An activity IS a route.** It lives in the Routes
section, labelled by what it was. It is not a pill, not a tag, and not its own section.

### TRIP — counted, never labelled

**A visit of more than one day counts as a Trip in the stats bar. Nothing is labelled a trip,
anywhere.**

⚠️ **This looks like a rule that was deliberately removed, and the difference matters.**
Migration `0047` made `visits.is_trip` a GENERATED column (`end_date > start_date`), which
promoted every multi-day visit to a trip *by arithmetic* — **50 of 485 visits were flagged
trips Erica never marked**, and the flag then drove labels and fusing behaviour. That is why
§10 says never to reintroduce a derived `is_trip`.

What is being asked for now is **not that**:

| Removed in 0133 | What Erica asked for, 2026-08-11 |
|---|---|
| A **stored flag** on the visit row | **No stored flag** |
| Drove UI labels ("· Trip") | **Nothing in the UI says Trip** — already removed from Visits |
| Changed rebuild fusing behaviour | **Changes nothing but a number** |
| Could be wrong about a specific visit forever | A count, recomputed from the dates every time |

So: **the stats bar counts visits whose end date is after their start date. No column, no
label, no behaviour.** That satisfies both her instruction and the reason 0047 was reverted.
**✅ DONE AND VERIFIED LIVE, 2026-08-11** (`a4f10ed1`, migrations `0159` + `0160`). The bar
now reads **16 trips** in the shared view, and tapping it opens all 16 in her format:
"Cape Cod · 8/2 - 8/7 · 5 nights".

The jump, measured after the fact rather than estimated: **Erica's view 9 → 42**, **Both
8 → 16**, **Josh 8 → 29**. (The earlier note here said 9 → 52; that counted every visit
row, including ones the stats bar excludes — it only counts `status='taken'` and the
current person scope. 52 is the *places* number.) Most multi-day stays were never marked;
the jump is the intended effect and is recorded here so nobody later "fixes" it back.

**TWO RULES COLLIDED, and both are honoured.** Deriving Trips purely from the dates would
have silently uncounted **three visits marked as trips BY HAND on a single day** — an
automation erasing a human decision, which is what `0157` exists to prevent. So the rule
is: **more than one day, OR marked by hand.** Nothing is erased and nothing needs a label.
Erica: if you want those three to stop counting, unmark them and the number follows.

`is_trip` stays as a thing a person may set — it just stopped being *required* for the count.

### How statistics are gathered

| Stat | Counts |
|---|---|
| **Places** | Distinct places visited — **each place once** |
| **Visits** | Every visit, every time |
| **Trips** | Visits spanning **more than one day** — derived at read time, never stored |
| **Miles** | Sum of activity distance |
| **Routes** | Activities with a track |

### What every card shows

- **A cover photo on every card.** An activity with no photo shows **the letter of the
  activity** instead — H for hike, R for run, B for biking, W for walking. A letter, because
  there are no icons.
- **The rating under the name**, in **two columns — one line across when there are two
  raters**. Anyone added to the card can rate it.
- Everything on a **visit** card is scoped to that visit. The **destination** rolls up every
  visit.

### THE CARD — LOCKED, approved 2026-08-11

> Erica: **"never redesign the card or add or delete anything from its template without
> my EXPRESS permission and approval of a preview."**

Approved preview (v5): https://claude.ai/code/artifact/8dafa822-fca5-460b-a58f-c914e89cdb97

**This section is the record of what she approved.** It was missing from STATE.md until
2026-08-11 — the one thing she locked was not written down anywhere, which is exactly how
a card gets rebuilt wrong. It is transcribed from the approved preview, not reinvented.

**ONE card. Five things use it and nothing about the template changes between them:**
a destination, a visit, an activity, a trail, and a blank new one.

**Top to bottom, always in this order:**

1. **Cover photo**, with × to close. No photo and it is an activity → **the letter of the
   activity** (H hike, R run, B biking, W walking). Never an icon.
2. **The name**, over the cover.
3. **Ratings, directly under the name** — one row per rater, `Name ★★★★★`, laid out in
   **two columns so two raters read as one line across**. A third wraps to the next line.
   Dim stars mean not rated yet. Anyone added to the card gets their own row.
   *(Her last note on the preview: reduce the space between the name and the stars.)*
4. **The address**, then a **sub-line** saying what this is in plain words:
   "Visited twice · 12 photos" · "Visited 62 times · 44.8 miles · 27 photos". On a VISIT
   card the sub-line is that visit's dates. Never a raw flag or a count with no noun.
5. **Category tags** as pills — Dining, Beach, Winery. **Never city or region pills.**
6. **The sections**, each headed by a **blue rule with an UPPERCASE WHITE heading**, and a
   quiet count or scope on the right ("12 · every visit"):

   | Section | Holds | On a VISIT card |
   |---|---|---|
   | **Visits** | Years as **dropdowns** (Show / Hide), newest first, only years that have visits. Inside, one line per visit: the date, and the segment name if it is a trail. | the one visit |
   | **Photos and videos** | ONE carousel, in date order, each with its date and the ♥ / 🔥 marks | scoped to the visit |
   | **Routes** | A map showing **every route from every visit**, then the list: name · type · miles · date. **Hikes, biking, walking and running all live here.** | only that visit's routes |
   | **Restaurants** | name + stars. Not on a trail card. | scoped to the visit |
   | **Notes and reviews** | note + date, and "Write a note or review" at the bottom | scoped to the visit |

7. **The footer**: "Add another visit" · "Delete". On the blank card: **Save · Cancel**.

**The blank (new) card** is the same card with the fields empty: "Add a cover photo",
"Name this place", the address **prefilled from where you tapped and editable**, and one
extra question asked **once, here only** — *"Is this a trail with sections?"* Its Visits
section says **"this is visit one"**, because **saving a new place IS its first visit**.
Routes and Restaurants say "Added once this first visit is saved".

**Gone from every card, and it stays gone:**

- the **Activities** section — hikes, rides, walks and runs are **routes**, and live in Routes
- **activity pills**
- the words **"Tap a date"**, **"Trip"** and **"Together"**, out of the Visits section entirely
- the **Sections** list on a trail — a segment name rides on the visit, so a trail's Visits
  section reads exactly like every other card's
- **"This is a Trail"** on a destination/visit card
- **city and region pills**, **"N places inside"**, **"+ Put a place inside this one"**,
  the blue **"+ Write a note"** link, and the **PLACES HERE** section

**Dates, everywhere on the card** (implemented once in `app/src/lib/visitDates.ts`, tested):
a single date is **"May 2"**, a range is **"5/4 - 5/7"**, and dates are **grouped by year**.

### Remove anything that rewrites or confuses this

Nothing may re-derive, relabel or overwrite the above. Specifically retired and not to return:
a `trip` place category; a stored/derived `is_trip` driving labels or behaviour; activity
pills; an Activities section separate from Routes; a Sections list (segments are visits with a
segment name); "places here"; City/Region pills; "N places inside".

### The earlier wording of this model, kept for context

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

| Function           | What it means                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Add**      | a place, a visit, an activity, by hand                                                                                       |
| **Import**   | Google Photos (guess the location from the photo's own coordinates, then let her correct it), file upload, Strava, the phone |
| **Ingest**   | what arrives automatically — proposed for approval, never written as fact                                                   |
| **Sort**     | photos into places and visits, with the location editable**right there**                                               |
| **Edit**     | names, locations, dates, who was there, categories, ratings                                                                  |
| **Organize** | sections into trails, places into trips and cities, merges                                                                   |
| **Delete**   | with undo                                                                                                                    |
| **Fix**      | duplicates, unnamed, unplaced — anything needing attention                                                                  |

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

|          |                                                                                               |
| -------- | --------------------------------------------------------------------------------------------- |
| File     | `build.protomaps.com/<date>.pmtiles` — daily OSM planet build, zoom 0–15                  |
| Size     | **137.3 GB** (2026-08-10 build), verified by content-length                             |
| Verified | HTTP 206 range requests,`PMTiles` spec v3, `accept-ranges: bytes`, served from Cloudflare |

**Cost, in R2 — flat, and the whole reason for doing it:**

| Line                                                                                       | Amount                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Storage 137.3 GB × $0.015/GB-month, minus the 10 GB free tier |**≈ $1.91 / month** |                                                                 |
| Class A (writes): ~1,400 multipart parts, one-time                                         | free (1M/month included)                                        |
| Class B (reads): 1 per tile served; two people browsing                                    | free (10M/month included)                                       |
| **Egress**                                                                           | **$0 — R2 never charges for it**                         |
| **Total**                                                                            | **≈ $2 / month, flat, no matter how much we look at it** |

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

| Bucket                                                                           | Count         | Safe?                                              |
| -------------------------------------------------------------------------------- | ------------- | -------------------------------------------------- |
| Exactly one visit at that place on that day                                      | **122** | yes — same place, same day, no ambiguity          |
| Fabricated`12:00:00` timestamp                                                 | **32**  | NO — the date is not real, so it must be proposed |
| No date at all                                                                   | 2             | no                                                 |
| Ambiguous (several candidate visits)                                             | 0             | —                                                 |
| Nothing is ambiguous, which is why this is worth doing: 122 can be attached with |               |                                                    |
| certainty, and 0157 now makes that attachment permanent.                         |               |                                                    |

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

| What she edits                             | Protected? | Notes                                                           |
| ------------------------------------------ | ---------- | --------------------------------------------------------------- |
| Visit dates, note, attribution, trip flag  | ✅ 0157    | trigger + rebuild refuses to delete                             |
| A photo pinned to a visit                  | ✅ 0157    | pin marks the visit decided                                     |
| **Place NAME**                       | ❌         | `name_locked` exists but the naming rules still write; verify |
| **Place dates** (first/last visit)   | ❌         | derived from evidence                                           |
| **Trail / segment membership**       | ❌         | `part_of` is rewritten by merges and rules                    |
| **Race names and assignment**        | ❌         | `assign_activity_to_race` rebuilds                            |
| **Activity name, type, attribution** | ❌         | learned naming rules rewrite these                              |
| **Categories and tags**              | ❌         | `sync_place_category` trigger                                 |
| **Cover photo, rating, review**      | ❌         | probably safe; verify                                           |

**And the Save button she asked for:** the trigger makes every save permanent
automatically, so the button is not strictly required to make it TRUE. It is required to
make it VISIBLE — she has been told twice that her work is safe and twice it was not. A
card that says *"Saved — automation will not change this"* with the date is the honest
version of the promise, and a way to hand a field back to automation if she ever wants it.

### FLOK — what the research settled (2026-08-11, two rounds: research then refutation)

**1. STRAVA CANNOT BE PART OF A PAID FLOK.** The risk recorded as UNVERIFIED is now
VERIFIED against the live policy (https://www.strava.com/legal/api_policy, effective
1 June 2026) and survived an adversarial re-check. Four clauses each independently kill it:

| Clause | What it says                                                         | What it kills                  |
| ------ | -------------------------------------------------------------------- | ------------------------------ |
| §5.7  | may not "aggregate, cache, or store geographic location information" | the whole map                  |
| §6.2  | may not retain Strava data "longer than seven (7) days"              | every history we hold          |
| §2.3  | data "may be displayed or disclosed … only to that user"            | showing Josh's outing to Erica |
| §5.8  | "**may not charge end users, in any manner**"                  | charging for Flok at all       |

Also: §5.10 forbids it *even with the user's consent*; §5.4 forbids aggregation/analytics;
§5.5 forbids persistent indexes; §5.3 forbids AI/ML. Access is 1 athlete by default, 10
self-serve, more only at Strava's discretion. Aggregators (Terra, Spike, Rook) were shut
out on 1 June 2026, so there is no back door.

**The escape hatch is the one already in use:** a user's own Strava EXPORT is not "data
accessible via the API", and 265 of 445 activities arrived that way. It conflicts with
Erica's "no importing files, that is a last resort" — and that tension IS the decision.

**2. The provider reality for a paid product**, after the refutation corrected the first
pass:

| Provider                                | Verdict                                                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Health API** (ex-Fitbit) | **The one clean win.** TCX with real GPS trackpoints. Needs OAuth verification + CASA review past 100 users; exercise pages cap at 25 items, so a decade of backfill is real engineering. Legacy Fitbit API dies Sept 2026 |
| **Garmin**                        | **OPEN — apply today.** ~2 business days. The first research pass said the programme was paused; that was WRONG. Business use only, and "commercial use requires a license fee payment" for some metrics                  |
| **Polar**                         | **CUT IT.** Forward-only from the moment of consent — a new user gets an empty map until their next workout. Not "90 days of history"                                                                                     |
| **Wahoo**                         | Narrow — returns only workouts recorded through Wahoo's own systems                                                                                                                                                             |
| **Suunto / Coros**                | Approval-gated / unverifiable. Small populations                                                                                                                                                                                 |
| **Google Timeline**               | No public API. Not now, not ever                                                                                                                                                                                                 |
| **Apple Health**                  | No web API. Native app or nothing                                                                                                                                                                                                |

**3. "Within 10 feet" would break the feature.** 3.05 m is below the noise floor of consumer
GPS. Measured against real accuracy distributions it discards **~80% of genuinely-together
moments in the open, ~91% under tree cover, ~99% in a city** — worst exactly where Erica
hikes. Two more floors sit under it: polyline precision-5 quantises to ~1.1 m, and
`summary_polyline` is decimated for display, deviating tens of metres.

**The fix is to stop deciding on distance and decide on DURATION of closeness:**

| Parameter    | Erica asked | Use                                                  | Why                                                                                    |
| ------------ | ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Distance     | 3 m         | **60 m**                                       | recovers ~100% open-sky and canopy. Strava's own tiles are 80 m                        |
| Start window | 10 min      | **±30 min**                                   | a fine filter, a terrible decision — 12 min apart then two hours together IS together |
| Overlap      | —          | **≥10 min AND ≥25% of the shorter activity** | below that it is a flyby, not a shared outing                                          |
| Coverage     | —          | **≥60% propose, ≥80% auto**                  | a stranger would have to hold pace within 0.10 km/h for 90 minutes to fake 80%         |
| Samples      | —          | **≥40 aligned**                               | one lucky point pair is not evidence                                                   |

Strava's shipped social grouping uses 80 m tiles and a **50%** threshold; 80% is stricter
than production. And the repo has the counterexample already: the 2026-03-07
Purcellville→Arlington run, which migration `0079`'s 800 m START-proximity rule never
caught, because the two records of the same run start in different places.

**4. One STATE.md line needs amending:** "Google Photos can no longer answer photos from
that day" is half wrong. You cannot SEARCH by date, but `createTime` comes back on every
picked item. Still no GPS.

### PLAN A TRIP TOGETHER — Erica's direction, 2026-08-11 *(new, not started)*

> "I also want to create a feature that allows users to collaborate to plan a trip"

⚠️ **THIS IS THE FIRST THING IN THE APP THAT IS ABOUT THE FUTURE.** Every noun in §2
records something that ALREADY HAPPENED: a place is somewhere you have been, a visit is a
date you were there, an activity is a route you covered. A plan is none of those, and the
one way this feature can wreck the locked system is by leaking into it — a planned trip
appearing in Places, or bumping the Trips count, or drawing a marker on the map as though
you had been there.

**THE RULE, and it is not negotiable: a plan counts for NOTHING until it happens.**
Plans live in their own tables. They are never read by `rebuild_place_visits`, never
counted by the stats bar, never drawn as a visited marker. §2's sentence "a place counts
once in Places" means once you have BEEN there.

**How it turns real.** A plan does not become a visit by the date passing — that would
invent history for a trip you cancelled. When the end date is past, the plan asks once:
*"Did you go?"* Yes creates the visit (one visit, one set of dates — §2) and the plan is
kept, attached to it, as what you meant to do. No, or no answer, and it stays a plan.
This is the only door between the two halves, and a human walks through it.

**Who can edit it.** Planning is the reason the Flok graph exists — it is the same
tagging-and-approval model, only pointed forward:

- The planner invites people from their flok. An invite is **accepted, declined, or
  maybe** — nobody is added to your trip without saying yes, exactly as with Together.
- Everyone accepted can add ideas, dates and notes. Only the planner can set the trip's
  final dates, and only the planner can answer "Did you go?" — one hand on the record.
- An idea is a **place you have not been** — so it must NOT create a `places` row on the
  spot. It holds a name, a coordinate and whatever the geocoder returned. If the trip
  happens, the ideas you actually did become real places at that moment, through the same
  path as any other new place.

**Voting, deliberately small.** The heart and the flame — the same two marks, the same
component, ALREADY BUILT for photos. No new vocabulary, no star ratings on things nobody
has seen. Rating is for places you have been (§2's card), and an idea is not one yet.

**The card.** A plan is shown with the LOCKED card structure — cover, name, the sections
in the same order, the blue rule and white uppercase headings. Nothing about the card
template changes; only what fills the sections. **Erica sees a preview and approves it
before any of this is built**, per her standing rule.

**Shape of the data** (written when built, not before):
`trip_plans` (owner, name, cover, target dates, status) · `trip_plan_members` (profile,
role planner/guest, invite status) · `trip_plan_ideas` (name, coords, who added it,
optional link to a real `places` row once it exists) · reactions reuse the existing
photo-reaction machinery pointed at an idea.

**Order of work:** the data model and the invite/accept flow first (they touch nothing
that exists), the card preview second, the "Did you go?" conversion last — because that
is the only part that can write history, and it should be built when everything around it
is settled.

### C — broken now, quietly (status 2026-08-11)

|    | What                                                                                                                                                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 | The photo-gateway deploy block piped EMPTY strings over two working Worker secrets (`$SUPABASE_SERVICE_ROLE_KEY` / `$SUPABASE_ANON_KEY` do not exist in `.env.local`) | ✅ fixed in §12c — right names, and it now REFUSES to write a blank                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C2 | `CLOUDFLARE_API_TOKEN` renamed to `…_MASTER`, but wrangler reads the un-suffixed name                                                                                  | ✅ fixed in §12b — mapped across, and`wrangler login` noted as the alternative                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| C4 | The tile meter counted only tiles. Mapbox**Search Box and Directions** are plain fetches billed per request and were invisible to it                                  | ✅**VERIFIED LIVE** on deploy `f38cc846`: typing in search moved `aon_api_budget` from nothing to 1. Four call sites metered (suggest, retrieve, forward, directions) with their own 2,000/day budget; refusing a search degrades honestly, unlike refusing a tile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C3 | Server-side geocoding dead since the MapTiler suspension — verified 403 on geocoding, not just tiles                                                                       | ✅**fixed, client and server.** `MAPBOX_TOKEN` is now a Supabase secret (it was absent — the app moved to Mapbox on 08-10, the functions did not). One shared `supabase/functions/_shared/geocode.ts` does Mapbox → MapTiler → nothing, and **zero `api.maptiler.com` calls remain** outside that fallback. `geocode-new-places`, `suggest`, `detect-trips`, `strava-webhook` and `strava-backfill` redeployed; all three callable ones verified BOOTING with the new module (a bad import 500s before the auth guard, and they return their own 401 instead). Client `reverseGeocode` prefers Mapbox too. **Not yet seen end-to-end**: naming a real new place needs an owner session (Erica's) or the next Strava ingest |
| C5 | The device ingest token travels as`?token=` and is therefore in Supabase's request logs in plaintext                                                                      | ❌ not started. Needs header support + a change to her iPhone Shortcut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| C6 | `the ` is set nowhere, so `ai-suggest` silently answers "not configured"                                                                                                | ❌ not started — needs a key, or the UI should say it is off rather than look unbuilt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Erica's directions, 2026-08-11 — to build

1. ✅ **VERIFIED LIVE** (`7797d885`) — **the redundant "+ Add" button at the top of the
   map is gone.** Asked for before and missed. The nav already has Add; §3 says one door
   per action. The hidden file input that sat beside it stays: it is what the photo-drop
   flow uses.
   Also live in the same deploy: **Import & sort photos** and **Import an activity file**
   now live in Settings → Manage data, and both are gone from the Add page ("Move Import
   and Sort Photos into Settings. Move import activities to settings."). Add is down to
   one action plus the review queue — the shape it needs for the approved card, where Add
   opens a fillable card.
2. ✅ **VERIFIED LIVE** — **Settings is the gear wheel, not a nav pill.** One continuous
   page (`.settings-tabs` count 0), nav exactly `[Map, Places, Add, Timeline]`.
   **Settings becomes the gear wheel, not a nav pill.** Account, Connections, Privacy,
   Data and Advanced all extracted onto ONE nicely styled page that opens from the gear
   (bottom-left). **No section labels** — not "Account", not "People" — it should read as
   one seamless page, not five tabs stacked.
   ⚠️ **CONFLICT, resolved with her:** §3 and the nav say FIVE tabs including Settings.
   This makes it four (Map / Places / Add / Timeline) with Settings behind the gear.
3. ⚠️ **BUILT, NOT YET SEEN LIVE** (`0913f05d`) — **Join Requests is now part of the
   People section**, rendered above the member list under the one People heading instead
   of as its own labelled section. Not verifiable from the test account: that whole block
   renders only for `role === 'owner'`, so **Erica has to confirm it**.
4. ✅ **VERIFIED LIVE** (`6354cfb2`) — **photos appear on the VISIT card.** Confirmed on a
   San Diego visit: 12 photos, 24 marks, under "Photos (12)".
   The mechanism was never missing — a photo belongs to a visit when its local day falls
   inside it, OR when it is pinned. What was missing was the pinning: **35 of 177 photos
   were pinned to nothing**. 33 of them had a date AND a place AND fell inside exactly
   ONE existing visit (checked for ambiguity first: zero photos matched two visits), so
   they were pinned. **175 of 177 now.** The last two have no date at all — the "Add
   date" pill on the thumbnail is how they get one, and no automation should guess it.
   *Reversible:* the id → visit_id list is saved; `set_photo_visit(id, null)` puts any
   photo back on its own date.
   Also fixed here: the visit card's photo strip was a SECOND, hand-rolled copy of the
   place card's carousel — which is exactly why the heart and flame landed on one and not
   the other. Both now render one `<ThumbMarks>` component, so the marks cannot change on
   one card and miss the other.
5. ✅ **VERIFIED LIVE** (`0913f05d`) — **the place card has ONE carousel** with the date,
   and **the heart and flame are on it**. Confirmed on San Diego: 22 photos, 1 carousel,
   44 marks, and a react round-trip that wrote and cleared again. The marks used to exist
   only inside the full-screen lightbox, which is why they read as "where did it go".
   A mark nobody has used is invisible until hover and always visible on a phone (no
   hover there); once someone reacts it stays up, because the count is the point.
   Migration **0158** adds `photo_reactions_for_many(uuid[])` — the single-photo RPC would
   have fired ~40 requests on opening San Diego. One round trip for the strip; reacting
   re-reads only the photo you touched. **Applied to production**, verified by the network
   log showing exactly one `photo_reactions_for_many` call.

### Smaller things the 2026-08-10/11 work turned up

- The people markers collide with a place cluster when someone is standing on one.
- **Josh's last-seen is 30 hours old** because a web app gets no background location on
  iOS. Giving him the same iOS Shortcut ingest Erica has would make "where we are" real.
- **MapLibre 6 is blocked** (§8) until a GeoJSON layer is proven to draw on it.

## 6. Why work kept getting erased — and what now prevents it

Five mechanisms, all evidenced:

| Mechanism                                                            | Fix                           |
| -------------------------------------------------------------------- | ----------------------------- |
| Six competing "what to do next" documents (~380 KB across ~40 files) | This file, and only this file |
| Removals not recorded as reversible                                  | The register in §7           |
| Hand-deploys bypassing CI                                            | Phase 1                       |
| Model rules leaking across layers (`holds_children` → invisible)  | Phase 2, plus a test          |
| Config vanishing silently (`VITE_GOOGLE_CLIENT_ID`)                | Phase 1 build assertion       |

---

## 7. Removed on purpose — the register

Anything deliberately removed goes here, with the commit, so it is never mistaken for
lost work and can be restored in minutes.

| What                                                           | When       | Why                                                                                                         | Restore from                                                                                                                      |
| -------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Address/place editing in the photo sorter (`PlaceQuickEdit`) | 2026-07-26 | She asked for "JUST THE VISIT INFORMATION" — place-level fields were confusing inside a visit-sorting flow | commit`5bb5b6e`; the component still exists, unused. **She now wants it back (Phase 3).**                                 |
| The`trips` and `trip_stops` tables                         | 2026-08-08 | A trip is a visit you marked, not a separate object                                                         | commit`aa6e553`                                                                                                                 |
| The 5-step Add wizard                                          | 2026-08-08 | Replaced by one add sheet                                                                                   | commit`fd3004d`                                                                                                                 |
| Service-worker registration                                    | earlier    | A cached shell served stale code                                                                            | restored 2026-08-10 with HTML network-first                                                                                       |
| `apply_naming_rule(uuid)` (geofence-only)                    | 2026-08-10 | It could rename 76 activities on start-point alone                                                          | migration`0152`                                                                                                                 |
| "downtown Leesburg, VA" as an Appalachian Trail section        | 2026-08-10 | Not on the AT.**The place itself was kept** — it holds 3 photos and 2 visits                         | migration`0155` (the earlier membership-row delete did not take: `part_of` is the record and its trigger rebuilds membership) |

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

| Document                                      | Claimed a trip is…                               |
| --------------------------------------------- | ------------------------------------------------- |
| ADR 0001 (deleted 2026-08-11, in git history) | a first-class`trips` row, **not** a place |
| `NewClaude.md` (deleted 2026-08-11)         | a**place** that is a non-counting rollup    |
| What Erica actually wants                     | a**visit she marked**                       |

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

| Stat   | Definition                                                         |
| ------ | ------------------------------------------------------------------ |
| Places | distinct places with a qualifying visit, where`counts_as_place`  |
| Visits | count of visit rows (the map badge = number of visits, never days) |
| Trips  | count of qualifying visits where`is_trip` and `status='taken'` |
| Miles  | sum of`activities.distance`, attributed the same way             |

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
   image whose EXIF lacks a camera make/model. (The iOS Shortcut also filters `Is Screenshot = false` and `Has GPS = true` — the Worker is the backstop, not the only gate.)
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
the subscription activates. Verify: `curl -G https://www.strava.com/api/v3/push_subscriptions \ -d client_id=<id> -d client_secret=<secret>` should list it. After that, finished activities
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

- `curl -H "Authorization: Bearer $ERICA_DEVICE_INGEST_TOKEN" --data-binary @geotagged.jpg \ -H "Content-Type: image/jpeg" https://<gateway>/ingest` → `{"ok":true,"id":...}`;
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
