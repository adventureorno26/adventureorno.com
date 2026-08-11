# Operate the photo-gateway Worker + R2

> **Token name changed 2026-08-11.** `.env.local` no longer has `CLOUDFLARE_API_TOKEN`.
> The working token is **`CLOUDFLARE_API_TOKEN_MASTER`** (verified against R2 and Pages).
> `CLOUDFLARE_ACCESS_TOKEN` in that file is NOT a valid API token. In CI the secret name
> is unchanged.


The Worker and R2 bucket are live. These are maintenance and redeployment steps,
not initial setup instructions. They require explicit production authority.

## 0. Before any production change

- Confirm the target account, Worker, R2 bucket, and current deployed version.
- Run Worker typecheck, unit tests, and Wrangler dry-run locally.
- Never print a device token or service-role key. Rotate a credential first if it
  has appeared in a log, document, commit, or chat transcript.

## 1. Confirm the existing R2 binding

`workers/photo-gateway/wrangler.toml` is the source of truth for the bucket binding.
List the account's buckets and confirm the configured bucket exists; do not run a
create/delete command during an ordinary deployment.

```bash
# Needs an API token with R2 edit + Workers Scripts edit (create at
# dash.cloudflare.com → My Profile → API Tokens → "Edit Cloudflare Workers"
# template, and add R2 Storage: Edit). Then:
export CLOUDFLARE_ACCOUNT_ID=<account-id>
export CLOUDFLARE_API_TOKEN=<the R2+Workers token>
cd workers/photo-gateway
npx wrangler r2 bucket list
```

## 2. Set Worker secrets
```bash
# service_role + anon keys the Worker uses for PostgREST / session checks.
# Values are in .env.local; SUPABASE_ANON_KEY is the current publishable/anon value.
printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
printf '%s' "$SUPABASE_ANON_KEY" | npx wrangler secret put SUPABASE_ANON_KEY
```

## 3. Deploy
```bash
npx wrangler deploy
# Note the printed URL, e.g. https://adventureorno-photo-gateway.<subdomain>.workers.dev
```

## 4. Point the SPA at it
Add to `.env.local` and to **Cloudflare Pages → adventureorno-com → Settings →
Environment variables** (Production + Preview):
```
VITE_PHOTO_GATEWAY_URL=https://adventureorno-photo-gateway.<subdomain>.workers.dev
```
Then rebuild and follow [`deploy-cloudflare.md`](deploy-cloudflare.md). Vite bakes
the value at build time; do not promote while required CI is red. The temporary
manual command, after verification and explicit approval, is:
```bash
cd ../../app && npm run build
cd .. && npx wrangler pages deploy app/dist --project-name adventureorno-com --branch main
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
