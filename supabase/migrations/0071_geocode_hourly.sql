-- 0071_geocode_hourly.sql — after a bulk import (e.g. Garmin), new leaf places
-- are created as "New place" (needs_geocode) and named from their LOCATION by
-- the geocode-new-places function. Nightly was too slow — Erica sees "New place"
-- until the next morning. Run it hourly so imports self-name within the hour.
-- (pg_cron.schedule upserts by jobname, keeping the same command.)

select cron.schedule(
  'geocode-new-places-nightly',
  '50 * * * *',
  $cmd$select net.http_post(
      url:='https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/geocode-new-places',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbmZ5aHNqYnRucXpwaHVvaWVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDM4NjU0NiwiZXhwIjoyMDk5OTYyNTQ2fQ.KlCDGZ1YYqfoEjje3TcHFRRLZwAaMxiLSU-ytfSHsi4'),
      body:='{}'::jsonb)$cmd$
);
