-- 0057_geocode_cron.sql — auto-name new places nightly. Activity/photo ingest
-- creates leaf places with needs_geocode=true; without a schedule they only got
-- named on a manual Settings trigger. This runs the good geocoder (Foursquare POI
-- → locality → county) every night so new places are properly named on their own.

select cron.schedule(
  'geocode-new-places-nightly',
  '50 7 * * *',  -- 07:50 UTC, after detect-trips (07:30)
  $$select net.http_post(
      url:='https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/geocode-new-places',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbmZ5aHNqYnRucXpwaHVvaWVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDM4NjU0NiwiZXhwIjoyMDk5OTYyNTQ2fQ.KlCDGZ1YYqfoEjje3TcHFRRLZwAaMxiLSU-ytfSHsi4'),
      body:='{}'::jsonb)$$
);
