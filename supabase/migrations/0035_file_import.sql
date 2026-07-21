alter table activities add column if not exists source text default 'strava';
alter table activities add column if not exists owner_profile uuid references profiles(id);

-- Attribute existing Strava activities to their athlete's profile.
update activities a set owner_profile = sa.profile_id
  from strava_accounts sa where a.athlete_id = sa.athlete_id and a.owner_profile is null;

-- New Strava activities (athlete_id set by ingest) auto-get owner_profile.
create or replace function set_activity_owner() returns trigger
language plpgsql set search_path to public as $$
begin
  if new.owner_profile is null and new.athlete_id is not null then
    new.owner_profile := (select profile_id from strava_accounts where athlete_id = new.athlete_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_activity_owner on activities;
create trigger trg_activity_owner before insert on activities
  for each row execute function set_activity_owner();

-- Import a GPX/TCX activity (Garmin workaround). Attributed to the uploader.
-- Dedupes against the SAME person's existing activities (±5min, ±2% distance).
create or replace function import_file_activity(
  p_name text, p_type text, p_polyline text, p_distance double precision,
  p_moving integer, p_lat double precision, p_lng double precision, p_date timestamptz
) returns uuid
language plpgsql security definer set search_path to public as $$
declare v_place uuid; v_id uuid; v_me uuid := auth.uid();
begin
  if not is_editor_or_owner() then raise exception 'not authorized'; end if;
  select id into v_id from activities
   where owner_profile = v_me and start_date is not null
     and abs(extract(epoch from (start_date - p_date))) < 300
     and abs(distance - p_distance) <= 0.02 * greatest(p_distance, 1)
   limit 1;
  if v_id is not null then return v_id; end if;  -- already imported

  v_place := assign_activity_place(p_lat, p_lng);
  insert into activities
    (strava_id, type, name, distance, moving_time, start_date, lat, lng, geom,
     place_id, summary_polyline, source, owner_profile)
  values
    (null, p_type, p_name, coalesce(p_distance, 0), p_moving, p_date, p_lat, p_lng,
     st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, v_place, p_polyline, 'file', v_me)
  returning id into v_id;
  if v_place is not null then perform recompute_place_stats(v_place); end if;
  perform dedupe_shared_outings();
  return v_id;
end $$;
