# Phase 2 — Photo pipeline: R2, Worker, gallery, Shortcut spec, deletion

## Objective
Photos flow in two ways — Erica's daily automated Shortcut and manual drag-and-drop for anyone —
land in R2 at 2400 px, appear in place galleries, and can be permanently deleted.

## Prerequisites (human)
R2 bucket `adventureorno-photos` + scoped API token (MANUAL-SETUP §5).

## Tasks
1. `workers/photo-gateway` (Wrangler, R2 binding):
   - `POST /ingest` — bearer auth against `ingest_tokens` (Erica's device token). Pipeline:
     SHA-256 hash → reject if in `deleted_hashes` (200 `{"skipped":"deleted"}`) or already in
     `photos` (dedupe) → parse EXIF (exifr) → **reject if: no GPS; PNG; no camera make/model**
     (screenshot backstop, 200 `{"skipped":"no_gps|screenshot"}`) → reject if inside home zone
     per `settings` (200 `{"skipped":"home_zone"}`) → resize longest edge 2400 px + 400 px thumb
     (strip GPS EXIF from both files) → write R2 → insert `photos` row (place_id NULL,
     source='shortcut', uploader=erica).
   - `POST /upload` — session-authenticated manual path (owner or editor). Same pipeline but:
     home-zone and screenshot checks become **warnings the user can override** (manual uploads
     are deliberate), and `source='manual'`, uploader = session user.
   - `GET /photo/:id?size=full|thumb` — session-authenticated, streams from R2 via short-lived
     signed URL. No other read path exists.
2. UI: drag-and-drop upload on place panel and a global "Add photos" that geolocates from EXIF
   client-side for preview before sending; gallery grid on place panel with lightbox;
   unassigned-photos tray on the map view ("12 photos awaiting a place" — until Phase 3
   clustering, allow manual assign-to-place).
3. **Deletion.** Trash icon on each photo (owner: all; editor: own uploads). Confirm dialog →
   delete R2 objects + row, insert hash into `deleted_hashes`. Vitest: a re-upload of the same
   bytes after deletion is rejected.
4. Write `/docs/ios-shortcut-daily.md`: exact step-by-step Shortcut spec — Find Photos where
   [Date is in last 1 day, Is Screenshot = false, Has GPS = true], limit 100 → repeat: Resize
   2400 px → Get contents of URL (POST, multipart, Authorization header) → count results →
   Notification summary. Plus both automation triggers (9 PM daily; home Wi-Fi join) and a
   note that failures self-heal via dedupe.
5. Health indicator in /settings: "Last automated upload: <timestamp>" with a yellow warning if
   > 48 h (Shortcuts silently dying is the known failure mode).

## Acceptance criteria
- A geotagged JPEG POSTs to /ingest and appears in the unassigned tray at ≤ 2400 px, GPS absent
  from the served file's EXIF, coordinates present in DB.
- A screenshot PNG and a Leesburg-radius photo are both skipped with the right skip codes.
- Deleting a photo removes it everywhere and the identical file can never be re-ingested.
- Partner-role session can use /upload but any request to /ingest with no valid device token 401s.
