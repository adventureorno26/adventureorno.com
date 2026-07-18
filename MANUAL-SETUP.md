# MANUAL-SETUP.md — steps only Erica can do

Do items 1–4 before starting Phase 1. The rest are flagged inside the phase briefs.

## 1. Domain (5 min)
Cloudflare dashboard → Domain Registration → Register Domains → buy **adventureorno.com**.
Nothing else needed yet; Phase 1 attaches it to Pages.

## 2. Repo & Claude Code ↔ GitHub connection (10 min)
Repo: **adventureorno26/adventureorno.com** (make it **private**: repo → Settings → General →
Danger Zone → Change visibility, if it isn't already). Then wire up Claude Code:
- `git clone https://github.com/adventureorno26/adventureorno.com.git` and work from that root.
- `gh auth login` → GitHub.com → HTTPS → "Login with a web browser" while signed into the
  **adventureorno26** account in that browser. Confirm with `gh auth status`. This is what lets
  Claude Code push branches and open PRs as you.
- Optional but recommended: inside a Claude Code session run `/install-github-app` and install
  the Claude GitHub App on this repo — you can then tag `@claude` on issues/PR comments and it
  works asynchronously from GitHub.
- Copy this package's CLAUDE.md to the repo root; MANUAL-SETUP.md + phases/ into /docs/.

## 3. Supabase — project already exists (5 min of settings)
Project: `https://aanfyhsjbtnqzphuoiem.supabase.co` · publishable key
`sb_publishable_3UufAcAfk9ftTwHuDNX-oQ_AnfbZ27D` (client-safe; goes in `.env.local` and
Cloudflare Pages env vars as `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`).
Still do these in the dashboard:
- Authentication → Sign In/Up: **disable "Allow new users to sign up"** (invite-only depends on
  this).
- Project Settings → API keys: copy the **service_role/secret key** into `.env.local` ONLY when
  Phase 1 asks. Never paste it into chats, commits, or client code.
- Database: Phase 1's migrations will enable PostGIS; no manual action.

## 4. MapTiler — key exists, restrict it (3 min)
Key `jCFByr4u55MrSeRYszGx` → `VITE_MAPTILER_KEY`. In cloud.maptiler.com → API keys → this key →
**Allowed HTTP origins**: add `adventureorno.com`, `www.adventureorno.com`, `localhost:5173`.
Unrestricted keys can be scraped from your bundle and drain the free tier.

## 5. Cloudflare R2 (Phase 2)
Dashboard → R2 → Create bucket `adventureorno-photos` (no public access). Create an R2 API token
scoped to that bucket for the Worker.

## 6. Strava API app (Phase 4, 10 min)
strava.com/settings/api → Create app. Category: Data Importer. Website: https://adventureorno.com.
Authorization Callback Domain: adventureorno.com. Save Client ID + Secret. Phase 4 walks the
one-time OAuth and webhook subscription.

## 7. iPhone setup — Erica's phone (Phase 2–3, ~20 min)
- Build the **daily photo Shortcut** from `/docs/ios-shortcut-daily.md` (Claude Code generates
  this exact spec in Phase 2). Automations: daily 9:00 PM + "when joining home Wi-Fi", both set
  to Run Immediately / no confirmation.
- Install **Overland** (App Store, free) → server URL + device token from Phase 3 output.
  Suggested settings: significant-location mode, batch 50, trip mode off.

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
