# Cloudflare Pages operations

> **Token name changed 2026-08-11.** `.env.local` no longer has `CLOUDFLARE_API_TOKEN`.
> The working token is **`CLOUDFLARE_API_TOKEN_MASTER`** (verified against R2 and Pages).
> `CLOUDFLARE_ACCESS_TOKEN` in that file is NOT a valid API token. In CI the secret name
> is unchanged.


Current project: `adventureorno-com` (Git-integrated), custom domains
`adventureorno.com` and `www.adventureorno.com`. This runbook operates the live
project; do not create a replacement project.

No step here authorizes a production change. Verify the target project, commit,
environment, and backup/rollback path before acting.

## Phase 1: stop red commits from auto-promoting

The project currently treats `main` as its production branch and can deploy even
when repository CI is red. Freeze that path first:

1. Cloudflare dashboard → **Workers & Pages** → `adventureorno-com` →
   **Settings** → **Builds & deployments** → **Configure Production deployments**.
2. Clear **Enable automatic production branch deployments** and save. Keep preview
   deployments enabled if they are useful; they do not control the custom domain.
3. Push no production deployment as part of this setting change. Confirm the
   existing known deployment remains served.

Cloudflare documents this control in
[Branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

## Environment inventory

Production and Preview need the client-safe values below. Copy real values from
the provider dashboards or the existing Cloudflare configuration; never put them
in this document or a commit.

```text
NODE_VERSION=22
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_MAPTILER_KEY
VITE_PHOTO_GATEWAY_URL
VITE_GOOGLE_CLIENT_ID
VITE_STRAVA_CLIENT_ID
VITE_MAPBOX_TOKEN          # optional
VITE_FOURSQUARE_KEY        # optional
```

Do not add a Supabase service-role key, provider client secret, device ingest
token, or Cloudflare API token to Pages build variables. Vite exposes `VITE_*`
values to the browser.

## Manual verified promotion (temporary)

Use only after every required Phase 1 check passes for the exact commit:

```sh
git status --short
git rev-parse HEAD
npm ci
npm run build --workspace app
npx wrangler pages deploy app/dist --project-name adventureorno-com --branch main
```

The command requires `CLOUDFLARE_ACCOUNT_ID` and a scoped
`CLOUDFLARE_API_TOKEN` in the shell. Do not echo either value. After upload, smoke
test `/login` and `/no-such-page`; confirm the deployment's commit and production
alias in Cloudflare before considering the promotion complete.

## Required end state: CI-gated promotion

After authenticated/mutating Playwright is green on fictional disposable data:

1. Create a Cloudflare API token limited to **Account / Cloudflare Pages / Edit**
   for the correct account.
2. Add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and the real production
   build-time values as GitHub Actions environment secrets. Protect a GitHub
   environment named `production` with required reviewer approval.
3. Add a deploy job that runs only for a push to `main`, declares `needs` for
   every required CI job, rebuilds from that same checked-out SHA, and runs the
   Wrangler command above. Do not use `workflow_run` with untrusted PR artifacts.
4. Keep Cloudflare automatic production deployments disabled. Prove the gate by
   observing that a deliberately failing test commit cannot create a production
   deployment, then promote a fully green commit.

Cloudflare's official pattern is documented in
[Direct Upload with continuous integration](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

## Supabase Auth redirects

Dashboard → **Authentication** → **URL Configuration**:

- Site URL: `https://adventureorno.com`
- Redirect URLs: the apex and `www` `/login` URLs, local `/login`, and only the
  preview URLs intentionally used for authentication testing.

Do not use the production Supabase project for automated acceptance tests.

## Rollback

Cloudflare → `adventureorno-com` → **Deployments** → select the last known-good
production deployment → **Rollback**. Then record the failed and restored
deployment IDs, commit SHAs, timestamps, and smoke-test result. Fix forward in Git;
do not hide the incident by rewriting history.
