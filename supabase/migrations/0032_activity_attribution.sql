-- Two-person attribution + shared-outing dedupe (non-breaking; ingest code will
-- populate these going forward). athlete_id = which Strava athlete recorded it.
alter table activities add column if not exists athlete_id bigint;
alter table activities add column if not exists shared_group_id uuid; -- same real-world outing done by both

-- Backfill: every existing activity belongs to the one connected athlete.
update activities set athlete_id = (select athlete_id from strava_accounts order by created_at limit 1)
  where athlete_id is null;

-- Make sure the existing account is attributed to Erica (owner) if not already.
update strava_accounts sa set profile_id = (select id from profiles where role='owner' limit 1)
  where profile_id is null;
