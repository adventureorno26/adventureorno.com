# iOS Shortcut — daily photo auto-upload (Erica's phone only)

This is the automation behind rule #7 ("auto-upload is Erica-only"). It finds the
day's geotagged, non-screenshot photos and POSTs each to the photo-gateway
`/ingest` endpoint with Erica's **device ingest token** as a bearer. The Worker
is the real gatekeeper — this Shortcut just avoids uploading obvious junk.

> **You need two things from the deploy step first:**
> 1. The gateway URL, e.g. `https://adventureorno-photo-gateway.<subdomain>.workers.dev`
> 2. Erica's raw **device ingest token** (shown exactly once when it's minted —
>    if you lost it, mint a new one; the old one keeps working until revoked).

---

## Build the Shortcut ("Adventure upload")

Shortcuts app → **+** → name it *Adventure upload*. Add these actions in order:

1. **Find Photos**
   - Filter: `Is Screenshot` **is** `false`
   - Filter: `Is Hidden` **is** `false`
   - Filter: `Date Taken` **is in the last** `1` `days`
   - Sort by `Date Taken`, `Oldest First`, **Limit** `100`
   - (Location isn't a Find-Photos filter — the Worker rejects anything with no
     GPS, so we don't need to pre-filter it here.)

2. **Set Variable** `Found` to `Find Photos` result (so we can count at the end).

3. **Repeat with Each** (item in `Find Photos`):

   1. **Resize Image** → *Repeat Item* → Width `2400` px, **Longest Edge**
      (choose "Fit into 2400×2400" so portrait photos scale by height). Quality
      default. *(The Worker also caps at 2400 — this just shrinks the upload.)*
   2. **Get Contents of URL**
      - URL: `https://<GATEWAY>/ingest`
      - Method: **POST**
      - Request Body: **File** → the *Resized Image* from the previous step
        (raw JPEG body — the Worker reads the raw bytes, no multipart needed)
      - Headers:
        - `Authorization` = `Bearer <ERICA_DEVICE_INGEST_TOKEN>`
        - `Content-Type` = `image/jpeg`
   3. *(optional)* **Get Dictionary Value** `skipped` from *Contents of URL* and
      **Add to Variable** `Skips` — lets the summary show how many were filtered.

4. **Count** items in `Found` → **Set Variable** `Total`.

5. **Show Notification** (title *Adventure upload*):
   `Uploaded <Total> photos.` (add `· <Skips count> skipped` if you built step 3.3)

Save.

---

## Automations (both "Run Immediately", confirmation off)

Shortcuts → **Automation** tab → **+**:

- **Time of Day** → `9:00 PM`, Daily → Run *Adventure upload* → **Run Immediately**,
  turn **Notify When Run** off.
- **Wi-Fi** → *Joins* your home network → Run *Adventure upload* → **Run Immediately**.

Two triggers give redundancy: if the phone is off Wi-Fi at 9 PM, joining home
Wi-Fi later still catches up.

---

## Why re-runs are safe

Every upload is content-hashed (SHA-256) in the Worker:

- Already stored → `{"skipped":"duplicate"}` (nothing changes)
- Previously deleted → `{"skipped":"deleted"}` (rule #6 — never reappears)
- Screenshot / no-GPS → skipped with that reason (there is no location filter)

So overlapping runs, retries, and the two automations firing the same day all
**self-heal** — you can't create duplicates and you can't resurrect a deleted
photo. If uploads ever stop, `/settings` shows a yellow "last automated upload
was > 48 h ago" warning (the Worker stamps the token on every authenticated call,
even when every photo is skipped).

---

## Minting Erica's device ingest token

Done once at deploy time. Generate a random token, store only its SHA-256 in
`ingest_tokens`, and paste the raw value into the Shortcut. There is deliberately
no UI to create more device tokens (rule #7). See
`docs/deploy-photo-gateway.md` for the exact command.
