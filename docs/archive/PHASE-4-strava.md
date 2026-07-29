# Phase 4 — Strava: webhooks, routes view, mileage counter

## Objective
Every finished Strava activity appears automatically; markers link to a routes-in-this-area map;
the stats bar shows a live total-miles counter.

## Prerequisites (human)
Strava API app created (MANUAL-SETUP §6); Client ID/Secret as Supabase secrets.

## Tasks
1. OAuth: /settings → "Connect Strava" (owner only) → standard authorization-code flow via Edge
   Function `strava-auth`; store athlete id + refresh token in a `strava_accounts` table
   (service-role only, RLS deny-all to clients). Token refresh helper shared by all Strava
   functions.
2. Edge Function `strava-webhook`: GET verify-challenge handshake; POST events → for
   `activity/create|update`, fetch the activity, upsert into `activities` (strava_id, type,
   name, start_point, distance m, moving_time, summary_polyline, start_date); for delete,
   remove the row. **Ingestion rule (CLAUDE.md #2):** type Hike/Walk/Run → always store; any
   other type → store only if start point outside home zone. Assign place_id = nearest place
   within 30 km, creating a place at the start point if none (a hike somewhere new proves the
   visit — these flow through the Phase 3 naming pipeline).
   One-time subscription creation script + printed instructions.
3. Edge Function `strava-backfill`: paginate athlete activities for a given date range with
   rate-limit sleeps (respect 100/15 min), same ingestion rule. Invoked from /settings with a
   progress indicator. (Phase 6 runs it for the past year.)
4. **Routes view** `/place/:id/routes`: MapLibre map fitted to the place's activities; decode
   summary polylines (@mapbox/polyline); color by type (hike/walk/run/ride/other); sidebar list
   with name, date, distance, moving time, deep link to strava.com/activities/:id. Marker
   popups now show a real "N routes" chip linking here.
5. **Mileage counter**: replace the Phase 1 placeholder. Total = Σ distance of ALL stored
   activities in miles, 1 decimal, animated count-up on load; hover/tap breakdown by type
   (e.g., Hiking 214.3 · Walking 156.0 · Running 89.2). Server-side aggregate view so the
   client never sums thousands of rows.

## Acceptance criteria
- Recording a short walk on Strava → activity appears within ~1 min, mileage total increments.
- A local Leesburg hike is stored (exemption); a hypothetical local Ride is skipped.
- Routes view for a place with 3 activities renders 3 correctly-colored polylines with working
  Strava links.
- Webhook endpoint rejects payloads failing Strava's verify token.
