# Manual provider and device operations

The project is already live. This file records owner-only provider/device
operations; it is not an initial build checklist. Never paste real credential
values into this file. Follow [`COMPLETION-PLAN.md`](COMPLETION-PLAN.md) for order.

## 1. Domain (5 min)
`adventureorno.com` is registered and attached to the live Pages project. Manage
DNS/custom domains only through the verified account and use
[`deploy-cloudflare.md`](deploy-cloudflare.md) for deployment controls.

## 2. Repo & Claude Code ↔ GitHub connection (10 min)
Repo: **adventureorno26/adventureorno.com** (private). To configure a new local
operator workstation:
- `git clone https://github.com/adventureorno26/adventureorno.com.git` and work from that root.
- `gh auth login` → GitHub.com → HTTPS → "Login with a web browser" while signed into the
  **adventureorno26** account in that browser. Confirm with `gh auth status`. This is what lets
  Claude Code push branches and open PRs as you.
- Optional but recommended: inside a Claude Code session run `/install-github-app` and install
  the Claude GitHub App on this repo — you can then tag `@claude` on issues/PR comments and it
  works asynchronously from GitHub.

## 3. Supabase — project already exists (5 min of settings)
Copy the project URL and current publishable key from the Supabase dashboard into
`.env.local` and the corresponding Cloudflare `VITE_*` variables. Then audit:
- Authentication → Sign In/Up: **disable "Allow new users to sign up"** (invite-only depends on
  this).
- Project Settings → API keys: copy the **service_role/secret key** into `.env.local` ONLY when
  Phase 1 asks. Never paste it into chats, commits, or client code.
- Database: Phase 1's migrations will enable PostGIS; no manual action.

## 4. MapTiler — key exists, restrict it (3 min)
Copy the current key into `VITE_MAPTILER_KEY`. In cloud.maptiler.com → API keys → this key →
**Allowed HTTP origins**: add `adventureorno.com`, `www.adventureorno.com`, `localhost:5173`.
Unrestricted keys can be scraped from your bundle and drain the free tier.

## 5. Cloudflare R2 (Phase 2)
The private `adventureorno-photos` bucket is live. Confirm it remains non-public;
use only a short-lived/scoped API token when maintenance requires one.

## 6. Strava API app (Phase 4, 10 min)
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

## 7. iPhone setup — Erica's phone (Phase 2–3, ~20 min)
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

## 8. Partner's iPhone (Phase 5, 5 min)
Nothing to install for ingestion (by design — his photos are manual-only). He just accepts his
invite email and optionally adds the site to his home screen (Share → Add to Home Screen).

## 9. One-time backfill (Phase 6)
- **Strava history:** automatic once Phase 4 auth exists — the backfill function pulls the past
  year (rate-limited, may take ~15 min).
- **Photos, past year:** build the one-shot variant Shortcut from `/docs/ios-shortcut-backfill.md`
  (same as daily but date range = last 365 days, runs in month-sized batches you trigger
  manually — expect it to churn a while; keep the phone plugged in).
- **Google Timeline (optional):** if you had Google Maps location history on your iPhone, request
  Takeout → Location History (Timeline) → drop the JSON into the importer at /settings/import.
  If you never used Google Timeline, skip — photos + Strava cover the year well.
