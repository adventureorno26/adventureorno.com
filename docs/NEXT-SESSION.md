# Paste this into a new session

Work on adventureorno.com. Read `docs/SCHEMA.md` FIRST — it is the authoritative data
model and it beats every other document. Do not redesign the schema; it was settled on
2026-08-08 (migrations 0129–0135) and re-litigating it is the single thing that has
wasted the most time on this project.

**Deploy rule:** production is Cloudflare Pages **Direct Upload**, so pushing to GitHub
does NOT deploy. `deploy-production` in CI still skips. Deploy by hand, verify, and
always end by telling Erica to hard-refresh (Cmd-Shift-R):

```
npm run build && npx wrangler pages deploy app/dist --project-name adventureorno
curl -s https://adventureorno.com/version.json     # must equal git rev-parse HEAD
```

`npm run build` stamps `version.json` from git HEAD, so it is trustworthy now. Verify
the deploy by comparing that sha, not by looking at a directory listing.

**Verify visually before shipping UI.** Login is Google-only so you cannot drive the
authenticated app. Instead: build, then render the real markup against the built CSS in
a local harness and screenshot it at 390x844. Two bugs shipped this week that a
screenshot would have caught in seconds. Do not skip this.

---

## 1. Attribution leaks across views — ONE root cause, two visible bugs

`places.solo_profile` is a **legacy place-level attribution column, superseded by
visit-level attribution**. It is `null` for almost every place, and `null` silently
means "show it to everyone".

* `app/src/components/StatsBar.tsx:75` filters the drill-down list with
  `!(personFilter && p.solo_profile && p.solo_profile !== personFilter)`. Because
  `p.solo_profile` is null, nothing is ever excluded — which is why **the Army Ten
  Miler shows in Josh's "Just Josh" view with Erica's stats**. The race RPCs
  (`races_list`, `race_stats`) are CORRECT and already filter by view, and both Army
  Ten Miler activities are correctly attributed to Erica. Only the client leaks.
* The same null column makes **Rehoboth Beach read "Both"** when its visit is
  correctly `solo_profile = Erica`, `solo_override = true`.

**Do:** delete `places.solo_profile` entirely and route every attribution read through
visit-level attribution (`place_ids_for_view`, `place_visit_counts`, `wander_stats`,
`races_list` — all of which already take `p_profile` and filter correctly). Snapshot
first; it is a destructive schema change. Then confirm all three toggles — Just Erica /
Just Josh / Both — produce different, correct numbers in every stat and dropdown.

Live truth to check against: places with more than one visit are **14** in Both,
**47** in Erica's view, **16** in Josh's.

## 2. The visit badge on the map

Erica wants a count on any place visited more than once. `MapView.tsx:669` already adds
a `place-visit-badge` symbol layer filtered `['>', ['get','visits'], 1]`, fed by
per-view `place_visit_counts`. The code reads correct and the data is right (14/47/16
above), so **the previous diagnosis was wrong** — do not guess again. Load the map,
inspect the actual GeoJSON feature properties, and find where `visits` is 0 or missing.
Likely suspects: `toFeatureCollection` running before counts load, or the ref/sync in
`MapView.tsx:342-350` and `831-850`.

## 3. Trail sections are split across two lists

On the Appalachian Trail card, segments appear under both "hikes" and "places". They
should be one **Sections** list, and anything added to the trail later should land
there too. `PlacePanel.tsx` already has a `trailSections` block (~line 1388) and
`fetchActivitiesForPlaceTree` aggregates a container's members' activities — but photos
are NOT aggregated, so a trail shows only its own. Consolidate into one section list and
aggregate member photos the same way.

Section counts must also differ per view (Just Erica / Just Josh / Both). `PlacePanel`
does not currently receive the person filter — that plumbing is needed and is the same
plumbing item 1 needs.

## 4. Redesign the add / "what is this place" flow  ← the big one

Erica has asked for this repeatedly and it keeps getting patched instead of designed.
Today there are FOUR surfaces asking one question: the map's `+ Add` menu, "Add a place
here", "Add to a trail", the "make this a city / region / trail" tags, and the 5-step
`/add` wizard.

Design it as **one sheet**, then delete what it replaces:

* **What are you adding?** — Photos · A place I've been · Somewhere to go later
* **Where does it belong?** (only for a place) — nothing, or a trail. Cities and regions
  attach SPATIALLY by boundary, so they are never a question to ask.
* **What is it?** — tags. There is no separate "make this a city/region/trail"; trail is
  the only container ever set by hand.

**Before deleting the top `+ Add` button:** it is NOT redundant, despite appearances.
It is the only entry point for **Add photos** and the **Google Photos import** — the
bottom Add tab opens the wizard and covers neither. Removing it orphaned 91 lines and
`importGooglePhotos` and had to be reverted. Move those two actions into the new sheet
first, then remove the button.

Erica's standing UI rules: **no icons** (the reaction marks are the one agreed
exception), no blur/glass controls, do not change the locked map-control layout, and
far fewer options — she has said "6000 stupid options" and she is right. The "Add to a
trail" dropdown used to list ~115 places; it now lists trails only.

## 5. Google Photos import has never worked

`google_tokens` has **zero rows, ever**. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are
set as Supabase secrets, the edge function is deployed, and the client ID IS in the
shipped bundle — so the server side is fine and the browser consent step never
completes. Most likely the OAuth client's Authorized JavaScript origins / redirect URIs
do not include `https://adventureorno.com`. That is a Google Cloud Console change only
Erica can make; ask her to check rather than guessing at code.

## 6. Smaller, already diagnosed

* **Brewster shows 3 rows for 1 visit.** The visit is correct (one fused 2-day stay);
  the card renders photos and activities as siblings of the visit instead of nested
  inside it. Evidence should nest under the visit — this is the remaining half of the
  place-card work.
* **`trips` / `trip_stops` tables** are retired by the model and Erica approved dropping
  them (8 trips, 13 stops, 0 notes — all migrated to visits with `is_trip`). Snapshot,
  confirm the exact scope with her, then drop.
* **Reaction marks** shipped: Love it + Crushed it, sticker style, on photos and
  activities (`ReactionMarks.tsx`, `lib/reactions.ts`, migration 0135). Erica chose
  these from a comparison of six style directions.

## Ground rules that were learned the hard way

1. **A one-shot data fix that a trigger can undo is not a fix.** Migration 0127 cleaned
   up the `trip` category; `sync_place_category` re-derived it on the next write and the
   bug came back. Remove the mechanism, not the rows.
2. **Never let a test pass vacuously.** A "no trip-category places" assertion passed on
   an empty local table and proved nothing. Seed the real shape, then assert, and add a
   negative control that fails when the rule is removed.
3. **Never mass-delete or overwrite without exact-scope confirmation from Erica**, and
   snapshot first.
4. Do not reintroduce the home exclusion zone anywhere. Never force-push.
5. Batch changes and deploy ONCE; rapid successive deploys leave half-updated bundles.
