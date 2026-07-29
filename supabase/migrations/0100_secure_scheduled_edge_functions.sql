-- 0100 — Keep scheduled Edge Function credentials out of migrations and
-- cron.job. Provision `aon_edge_secret_key` in Supabase Vault out of band.
--
-- Both target functions use verify_jwt=false and authenticate scheduled calls
-- by comparing the apikey header with their encrypted AON_SUPABASE_SECRET_KEY.

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
