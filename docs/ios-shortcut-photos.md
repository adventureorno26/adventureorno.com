# iPhone auto-upload Shortcut (photos → AdventureOrNo inbox)

Each person installs this once. It uploads new photos automatically; they land in
the **Photo Sorter inbox** (Settings → Sort photos into places) as private, unsorted
drafts until you file them onto a place. Only you see your own inbox until you save.

## What it does
Posts each photo's bytes to the photo-gateway `/ingest` endpoint with your personal
device token. Screenshots and images without camera EXIF are rejected automatically.

- **Endpoint:** `https://adventureorno-photo-gateway.adventureorno26.workers.dev/ingest`
- **Auth header:** `Authorization: Bearer <YOUR DEVICE TOKEN>`
- **Body:** the raw photo (JPEG), `Content-Type: image/jpeg`

Your device tokens are per-person secrets (issued once, stored only as a hash in
`ingest_tokens`). Keep them private; if one leaks, revoke it by setting
`revoked_at` on that row and mint a new one.

## Build the Shortcut (Automation)
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

## Verify
After it runs, open the app → **Settings → Sort photos into places**. Your uploaded
photos appear as **"N photos waiting in your inbox"** → tap **Sort my inbox** → the
timeline engine proposes a place for each; confirm each group.
