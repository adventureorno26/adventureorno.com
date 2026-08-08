-- 0057_geocode_cron.sql — auto-name new places nightly. Activity/photo ingest
-- creates leaf places with needs_geocode=true; without a schedule they only got
-- named on a manual Settings trigger. This runs the good geocoder (Foursquare POI
-- → locality → county) every night so new places are properly named on their own.
--
-- Provision `aon_edge_secret_key` in Supabase Vault out of band. Modern
-- sb_secret_ keys must be sent only in the apikey header and must never be
-- committed to a migration or copied into cron.job.

select cron.schedule(
  'geocode-new-places-nightly',
  '50 7 * * *',  -- 07:50 UTC, after detect-trips (07:30)
  $$select net.http_post(
      url:='https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/geocode-new-places',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'apikey',(
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'aon_edge_secret_key'
        )),
      body:='{}'::jsonb)$$
);
