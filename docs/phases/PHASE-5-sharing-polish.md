# Phase 5 — Partner access, trips, PWA polish

## Objective
Partner onboarded as co-editor; the app feels like a finished product on phones.

## Tasks
1. Invites UI (/settings → People): owner sends invite with role viewer|editor, sees
   pending/redeemed, can revoke access. Send the partner's editor invite as the live test.
   Enforce in UI + RLS: editor can create/edit entries and places, upload/delete own photos,
   edit place names; cannot touch settings, home zone, ingest tokens, invites, or Strava
   connection. Confirm no path exists for an editor to mint a device ingest token.
2. Trips: create trip (name, date range) → places auto-attach by first_visit within range;
   trips list view with per-trip stats (places, photos, miles from activities in range);
   optional path line on the map from that range's pings.
3. Photo→entry linking: attach specific photos to an entry so the carbonara shot sits on the
   restaurant note; entry cards show their photos.
4. PWA: manifest + icons + service worker (cache shell only, never photo data), so
   add-to-home-screen feels native on both iPhones. Empty states, loading skeletons, mobile
   layout pass (the panel becomes a bottom sheet), favicon, og:tags pointing at a generic
   image (no photo leakage in link previews).
5. Lighthouse mobile pass ≥ 90 performance on the map view with 100 places.

## Acceptance criteria
- Partner logs in on his iPhone, adds a restaurant entry with a manually-uploaded photo,
  deletes his own photo, and is blocked (UI and API) from /settings admin cards.
- A "Portugal 2026" trip auto-contains its date-range places and shows correct stats.

# Phase 6 — Backfill the past year

## Objective
The map reflects the last 12 months of travel, not just post-launch life.

## Tasks
1. Run `strava-backfill` for the trailing 365 days from /settings; verify mileage total.
2. Write `/docs/ios-shortcut-backfill.md`: one-shot Shortcut identical to the daily one but
   parameterized by month (Find Photos where Date is between X and Y, same filters), run
   manually month-by-month; the ingest pipeline's dedupe + filters make this safe to re-run.
3. Google Timeline importer at /settings/import: accept Takeout Location History JSON
   (semanticSegments / timelinePath formats), map to `location_pings` with home-zone filtering,
   then trigger the clustering job. Clearly optional — skip gracefully if Erica never used
   Google Maps timeline.
4. After backfill: run clustering, then a cleanup session in the UI — merge duplicates, rename
   ugly geocodes, pick cover photos.

## Acceptance criteria
- Past-year Strava miles included in the counter; a month of 2025 photos ingested via the
  backfill Shortcut produces sensible clustered places; re-running any backfill creates zero
  duplicates.
