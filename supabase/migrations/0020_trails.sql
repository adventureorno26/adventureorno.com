-- Trails are places (is_trail = true): a linear trail like the W&OD, Appalachian,
-- or Tuscarora, listed under Places. Runs/hikes on a trail attach to that place
-- (via place_id, same as any activity) and are grouped on the card by trailhead.
-- `trailhead` is the human label for where a given run started; when null the UI
-- falls back to the Strava activity name.
alter table places add column if not exists is_trail boolean not null default false;
alter table activities add column if not exists trailhead text;

create index if not exists places_is_trail_idx on places (is_trail) where is_trail;
