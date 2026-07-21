# How to use this package

[![CI](https://github.com/adventureorno26/adventureorno.com/actions/workflows/ci.yml/badge.svg)](https://github.com/adventureorno26/adventureorno.com/actions/workflows/ci.yml)

1. Complete MANUAL-SETUP.md items 1–4 (domain; GitHub auth for `adventureorno26/adventureorno.com`
   including `gh auth login`; Supabase settings on the existing project; MapTiler key domain
   restriction).
2. Copy `CLAUDE.md` to the repo root. Copy `MANUAL-SETUP.md` and `phases/` into `/docs/`.
   Create `.env.local` (gitignored) with:
   ```
   VITE_SUPABASE_URL=https://aanfyhsjbtnqzphuoiem.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_3UufAcAfk9ftTwHuDNX-oQ_AnfbZ27D
   VITE_MAPTILER_KEY=jCFByr4u55MrSeRYszGx
   SUPABASE_SERVICE_ROLE_KEY=   # paste from dashboard when Phase 1 asks; never commit
   ```
3. Open Claude Code in the repo root and start each session with:

   > Read CLAUDE.md and docs/phases/PHASE-N-*.md. Implement Phase N completely. Stop and give me
   > exact instructions whenever a step needs my dashboard access or my phone. Do not start the
   > next phase.

4. One phase per session, in order. Verify the acceptance criteria yourself before moving on —
   they're written so you can literally walk through them.
5. When a phase asks you to do something on your phone or a dashboard, the exact steps will be in
   the session output and in `/docs/` (Shortcut specs, Overland config, Strava OAuth).

Decisions already locked into these briefs: iPhone-only automation (Erica's device solely);
15-mile Leesburg exclusion with Hike/Walk/Run Strava exemption; total-miles counter; 2400 px web
versions, originals not retained; screenshots blocked at Shortcut and server; permanent deletion
with a re-upload blocklist; partner = editor with manual upload only; one-year backfill;
repo adventureorno26/adventureorno.com; domain adventureorno.com via Cloudflare; work flows
through PR-per-phase via the gh CLI.
