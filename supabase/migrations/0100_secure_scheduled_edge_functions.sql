-- 0100 — Keep scheduled Edge Function credentials out of migrations and
-- cron.job. Provision `aon_edge_secret_key` in Supabase Vault out of band.
--
-- Both target functions use verify_jwt=false and authenticate scheduled calls
-- by comparing the apikey header with their encrypted AON_SUPABASE_SECRET_KEY.
-- The apikey is read from Vault at RUN TIME (not baked into cron.job), so rotating
-- the secret needs no migration and no plaintext key ever lands in a dumped catalog.
--
-- Hardening (ADR 0001 corrective pass, item 12):
--   * PREFLIGHT: refuse to schedule if the Vault secret is absent. Without this a
--     missing secret would silently schedule a job that POSTs a NULL apikey — a job
--     that looks healthy but 401s every night. Fail at apply time instead.
--   * NO LEGACY FALLBACK: the apikey comes ONLY from `aon_edge_secret_key`. The
--     revoked inline JWT that 0057/0071 once shipped must never return as a default
--     (see docs/decisions.md, sanitization exception).
--   * IDEMPOTENT / SAFE REPLACEMENT: cron.schedule(name, ...) upserts by name, so a
--     re-apply replaces the existing job rather than duplicating it. We also
--     explicitly unschedule any prior job of the same name first, so a stale
--     definition (e.g. a legacy geocode job from 0057/0071) can never linger next
--     to the new one.
--
-- On the DISPOSABLE local stack the secret is provisioned as a dummy by
-- scripts/db-bootstrap.sh before apply, and every cron job is unscheduled
-- immediately after apply (network isolation) — so no HTTP ever fires locally.
--
-- VERIFY on the disposable local stack (never production).
-- ROLLBACK:
--   select cron.unschedule('detect-trips-nightly')
--     where exists (select 1 from cron.job where jobname = 'detect-trips-nightly');
--   select cron.unschedule('geocode-new-places-nightly')
--     where exists (select 1 from cron.job where jobname = 'geocode-new-places-nightly');

-- PREFLIGHT — fail loudly if the Vault secret has not been provisioned, rather than
-- scheduling a job that would authenticate with a NULL apikey.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'aon_edge_secret_key'
  ) then
    raise exception
      '0100: Vault secret aon_edge_secret_key is not provisioned; refusing to '
      'schedule Edge Function jobs that would POST a NULL apikey. Create it '
      '(dashboard Vault, or vault.create_secret) before applying.';
  end if;
end $$;

-- SAFE REPLACEMENT — drop any prior job of the same name before (re)scheduling, so
-- a re-apply (or a legacy 0057/0071 geocode job) can never leave a duplicate behind.
select cron.unschedule('detect-trips-nightly')
  where exists (select 1 from cron.job where jobname = 'detect-trips-nightly');
select cron.unschedule('geocode-new-places-nightly')
  where exists (select 1 from cron.job where jobname = 'geocode-new-places-nightly');

select cron.schedule(
  'detect-trips-nightly',
  '30 7 * * *',
  $cmd$select net.http_post(
      url:='https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/detect-trips',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'apikey',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'aon_edge_secret_key'
        )),
      body:='{}'::jsonb)$cmd$
);

select cron.schedule(
  'geocode-new-places-nightly',
  '50 * * * *',
  $cmd$select net.http_post(
      url:='https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/geocode-new-places',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'apikey',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'aon_edge_secret_key'
        )),
      body:='{}'::jsonb)$cmd$
);
