# iOS Shortcut — one-shot photo backfill (past year)

Same pipeline as the daily Shortcut (`ios-shortcut-daily.md`), but you run it
**manually, one month at a time**, over a date range instead of "last 1 day". The
Worker's SHA-256 dedupe makes overlapping months safe — re-running never creates
duplicates and never resurrects a deleted photo.

> Prereq: the photo-gateway must be deployed (`deploy-photo-gateway.md`) and you
> need the gateway URL + Erica's device ingest token (in `.env.local` as
> `ERICA_DEVICE_INGEST_TOKEN`) — the same ones the daily Shortcut uses.

## Build "Adventure backfill"

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

## Run it month by month

Trigger it manually (Shortcuts app → tap it), changing the date range each run:

- Jul 2025, Jun 2025, May 2025 … back through Aug 2024.
- Keep the phone **plugged in and on Wi-Fi** — a month of photos can take a while.
- Watch the map fill in; the nightly clustering job (or **Settings → Cluster now**)
  turns the new photos into places, and geocoding names them.

## Why month-sized batches

- Shortcuts can time out or run out of memory on thousands of photos at once.
- Smaller runs are easy to retry — and because every upload is content-hashed,
  re-running a month you already did just returns `duplicate`/`deleted` for each
  photo and stores nothing new.

## After the photo + Strava backfills

1. **Settings → Strava → Backfill last 12 months** (see `MANUAL-SETUP §6`).
2. **Settings → Cluster now**, then **Name new places**.
3. **Settings → Import Google Timeline…** if you have a Takeout/Timeline export
   (optional — skip if you never used it).
4. Cleanup pass on the map: merge duplicate places, rename any ugly geocodes,
   set cover photos. Everything is an editable default.
