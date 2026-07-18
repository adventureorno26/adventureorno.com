# Deploy — Cloudflare Pages (Phase 1)

The SPA in `/app` deploys to Cloudflare Pages, custom domains
`adventureorno.com` + `www`. These are dashboard steps only Erica can do.

## A. Create the Pages project (connect the repo)
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Pick `adventureorno26/adventureorno.com`. Production branch: **main**.
3. Build settings:
   - **Framework preset:** None / Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `app/dist`
   - **Root directory:** *(leave blank — repo root; the workspace build emits to `app/dist`)*
   - **Node version:** set env var `NODE_VERSION = 20` (or newer)
4. **Environment variables** (Production **and** Preview) — add:
   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | `https://aanfyhsjbtnqzphuoiem.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` key |
   | `VITE_MAPTILER_KEY` | the MapTiler key |
   | `NODE_VERSION` | `20` |
   > Only `VITE_*` values are client-safe. **Never** add the service_role key here.
5. **Save and Deploy.** The first build produces a `*.pages.dev` preview URL.

## B. Custom domains
1. Pages project → **Custom domains** → **Set up a domain** → add
   `adventureorno.com`, then again for `www.adventureorno.com`.
2. Because the domain is registered in this same Cloudflare account, DNS records
   are added automatically. Wait for "Active".

## C. Supabase Auth redirect URLs
Supabase must allow the magic-link redirect back to the site.
- Dashboard → **Authentication → URL Configuration**:
  - **Site URL:** `https://adventureorno.com`
  - **Redirect URLs:** add
    `https://adventureorno.com/login`,
    `https://www.adventureorno.com/login`,
    `http://localhost:5173/login`,
    and the current `*.pages.dev/login` preview URL.

## D. Deploy the Edge Function + apply the migration
From a terminal with the Supabase CLI (`npm i -g supabase`) and Docker not
required for remote-only:
```bash
supabase login
supabase link --project-ref aanfyhsjbtnqzphuoiem
supabase db push                 # applies supabase/migrations/0001_init.sql
supabase functions deploy invite # deploys the owner-only invite function
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
into Edge Functions automatically — no secrets to set for `invite`.

> Alternative if you prefer no CLI: paste `supabase/migrations/0001_init.sql`
> into the dashboard **SQL editor** and run it. The Edge Function still needs the
> CLI (or the dashboard's function editor) to deploy.

## E. Bootstrap the owner, then verify
1. Create Erica's auth user: **Authentication → Users → Add user** (send invite)
   with her real email.
2. Run `supabase/seed-owner.sql` in the SQL editor (Option A).
3. Open the emailed link → you land on `/login`, the app calls `claim_invite()`,
   and you get an owner profile → the map loads.
4. (Optional) Run `supabase/seed-test-places.sql` to check world-zoom clustering.
