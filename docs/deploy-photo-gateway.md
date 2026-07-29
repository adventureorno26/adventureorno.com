# Deploy: photo-gateway Worker + R2 (Phase 2)

The Worker code is complete (`workers/photo-gateway/`). These are the steps that
need Cloudflare R2 credentials the session tokens don't carry, so they're done by
hand once. After this, the daily Shortcut and manual uploads work end-to-end.

## 0. Prereqs already done (by the session)
- Migration `0002_photos.sql` applied to the live DB (`photos.source`,
  `photos.is_landscape`, `places.cover_photo_id`, `last_automated_upload()` RPC).
- Erica's **device ingest token** minted — hash stored in `ingest_tokens`, raw
  value saved to `.env.local` as `ERICA_DEVICE_INGEST_TOKEN` (and printed once in
  the session). This is the only device token (rule #7).

## 1. Create the R2 bucket
```bash
# Needs an API token with R2 edit + Workers Scripts edit (create at
# dash.cloudflare.com → My Profile → API Tokens → "Edit Cloudflare Workers"
# template, and add R2 Storage: Edit). Then:
export CLOUDFLARE_ACCOUNT_ID=9bed5239120cee4e9e7d46fa69ef4784
export CLOUDFLARE_API_TOKEN=<the R2+Workers token>
cd workers/photo-gateway
npx wrangler r2 bucket create adventureorno-photos
```

## 2. Set Worker secrets
```bash
# service_role + anon keys the Worker uses for PostgREST / session checks.
# Values are in .env.local (SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_PUBLISHABLE_KEY).
echo "$SUPABASE_SERVICE_ROLE_KEY"        | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
echo "sb_publishable_3UufAcAfk9ftTwHuDNX-oQ_AnfbZ27D" | npx wrangler secret put SUPABASE_ANON_KEY
```

## 3. Deploy
```bash
npx wrangler deploy
# Note the printed URL, e.g. https://adventureorno-photo-gateway.<subdomain>.workers.dev
```

## 4. Point the SPA at it
Add to `.env.local` and to **Cloudflare Pages → adventureorno → Settings →
Environment variables** (Production + Preview):
```
VITE_PHOTO_GATEWAY_URL=https://adventureorno-photo-gateway.<subdomain>.workers.dev
```
Then rebuild + redeploy Pages (Vite bakes env at build time):
```bash
cd ../../app && npm run build
cd .. && CLOUDFLARE_ACCOUNT_ID=9bed5239120cee4e9e7d46fa69ef4784 \
  npx wrangler pages deploy app/dist --project-name adventureorno
```

## 5. Verify (acceptance criteria)
- `curl -H "Authorization: Bearer $ERICA_DEVICE_INGEST_TOKEN" --data-binary @geotagged.jpg \
   -H "Content-Type: image/jpeg" https://<gateway>/ingest` → `{"ok":true,"id":...}`;
  photo shows in the unassigned tray, ≤ 2400 px, no GPS in the served file's EXIF.
- POST a screenshot PNG → `{"skipped":"screenshot"}`. (There is no location filter —
  a geotagged photo taken at home is stored like any other.)
- Delete it in the UI, re-POST the same bytes → `{"skipped":"deleted"}` (rule #6).
- `/ingest` with a bad/absent token → 401. A partner session can `/upload` but
  never `/ingest`.

## Optional: custom subdomain / route
For a stable URL you can add a route like `photos.adventureorno.com/*` in
`wrangler.toml` (`routes = [...]`) once the DNS record exists; not required — the
`*.workers.dev` URL is fine for a private app.
