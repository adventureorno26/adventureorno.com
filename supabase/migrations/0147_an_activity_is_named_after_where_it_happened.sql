-- An activity is named after WHERE IT HAPPENED.
--
-- Erica: "why did you name 181 activities morning walk instead of actually
-- figuring out where it was? I want the names of real places, not 'morning walk'."
--
-- She is right, and the old behaviour was mine: the file importer invented
-- "Morning Walk" / "Evening Hike" from the clock. Strava does the same thing to its
-- own uploads. Both tell you the time of day, which the date already says, and
-- nothing at all about where you were.
--
-- The fix is that a generic name is not a name. When the incoming name is blank, a
-- time-of-day label, or an export filename, the activity takes the name of the
-- place it was just placed at — which is already geocoded, and which the AllTrails
-- pass has now filled in with real parks and trails. A name a person actually
-- wrote ("Old Rag with Josh", "San Clemente Walk with Josh - phone died") is never
-- touched.
--
-- Nothing is removed here: one new function, and one line of import_file_activity
-- changed (the INSERT's name value). Everything else in that function is byte-for-
-- byte the live definition.

begin;

-- 1. IS THIS A REAL NAME, OR JUST A CLOCK READING?
--    Kept separate and IMMUTABLE so the rule is testable on its own and can be
--    reused by any ingest path (file import, Strava, a future Garmin/AllTrails one).
create or replace function public.is_generic_activity_name(p_name text)
returns boolean
language sql
immutable
as $function$
  select case
    when btrim(coalesce(p_name, '')) = '' then true
    -- Strava's own defaults, and the ones the file importer used to mint:
    -- "Morning Walk", "Lunch Run", "Night Hike", "Afternoon Ride"…
    when btrim(p_name) ~*
      '^(morning|afternoon|evening|night|lunch|late[ -]?night)[ _-]+(walk|run|hike|ride|swim|workout|activity|jog|cycle)s?$'
      then true
    -- Bulk-export filenames from Garmin and Strava:
    -- "hiking 2018-01-14 14:34", "2018-01-14T09:12", "activity_1234567"
    when btrim(p_name) ~* '^(hiking|running|cycling|walking|swimming|activity|workout)[ _-]*\d{4}-\d{2}-\d{2}' then true
    when btrim(p_name) ~  '^\d{4}-\d{2}-\d{2}[ T_-]' then true
    when btrim(p_name) ~* '^activity_?\d+$' then true
    -- A bare type ("Hike", "Walk") says nothing either.
    when btrim(p_name) ~* '^(walk|run|hike|ride|swim|workout|activity)$' then true
    else false
  end;
$function$;

comment on function public.is_generic_activity_name(text) is
  'True when an incoming activity name is a clock reading or an export filename '
  'rather than something a person wrote. Such names get replaced by the place name.';

-- 2. THE NAME AN ACTIVITY SHOULD CARRY.
--    A person's own words always win. Otherwise: the place. Only if there is no
--    place either does it fall back to the type, so a row is never left nameless.
create or replace function public.activity_display_name(
  p_given text, p_place uuid, p_type text
) returns text
language sql
stable
as $function$
  select coalesce(
    -- 1. what a person wrote, if it is a name at all
    nullif(case when public.is_generic_activity_name(p_given)
                then null else btrim(p_given) end, ''),
    -- 2. where it happened
    (select nullif(btrim(p.name), '') from public.places p where p.id = p_place),
    -- 3. nothing to go on: the type. NOT p_given — falling back to it would hand
    --    "Morning Hike" straight back for an unplaced activity, which is the whole
    --    bug. A row like this is what the review queue is for.
    nullif(btrim(p_type), ''),
    'Activity');
$function$;

comment on function public.activity_display_name(text, uuid, text) is
  'What to call an activity: the name a person wrote, else the place it happened at.';

-- 3. WIRE IT INTO THE FILE IMPORT. Only the name value in the INSERT changes; the
--    dedup blocks, the placement call and the cutoff logic are exactly as they were.
create or replace function public.import_file_activity(
  p_name text, p_type text, p_polyline text, p_distance double precision,
  p_moving integer, p_lat double precision, p_lng double precision,
  p_date timestamp with time zone
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_place uuid;
  v_id uuid;
  v_cutoff constant date := '2025-12-21';
  v_pt geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select id into v_id from public.activities
   where owner_profile = v_me
     and abs(extract(epoch from (start_date - p_date))) < 600
     and (type = p_type
          or abs(coalesce(distance,0) - coalesce(p_distance,0)) < greatest(80, coalesce(p_distance,0)*0.06))
   limit 1;
  if v_id is not null then return v_id; end if;

  if p_lat is not null and p_lng is not null then
    select id into v_id from public.activities a
     where a.owner_profile is not null and a.owner_profile <> v_me
       and a.type = p_type
       and a.start_date::date = p_date::date
       and a.geom is not null and st_dwithin(a.geom, v_pt, 800)
       and abs(coalesce(a.distance,0) - coalesce(p_distance,0)) <= 804
     limit 1;
    if v_id is not null then
      update public.activities set solo_profile = null where id = v_id;
      perform public.recompute_place_stats(place_id), public.rebuild_place_visits(place_id)
        from public.activities where id = v_id;
      return v_id;
    end if;
  end if;

  v_place := public.place_for_activity(p_lat, p_lng, p_type, p_name);
  insert into public.activities
    (strava_id, type, name, distance, moving_time, start_date, lat, lng,
     place_id, summary_polyline, source, owner_profile, solo_profile)
  values
    (null, p_type,
     -- CHANGED: was p_name. A clock reading is not a name — use the place.
     public.activity_display_name(p_name, v_place, p_type),
     coalesce(p_distance, 0), p_moving, p_date, p_lat, p_lng,
     v_place, p_polyline, 'file', v_me,
     case when p_date < v_cutoff then v_me else null end)
  returning id into v_id;
  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
  return v_id;
end
$function$;

revoke all on function public.import_file_activity(text,text,text,double precision,integer,double precision,double precision,timestamptz) from public;
revoke all on function public.import_file_activity(text,text,text,double precision,integer,double precision,double precision,timestamptz) from anon;
grant execute on function public.import_file_activity(text,text,text,double precision,integer,double precision,double precision,timestamptz) to authenticated;

-- 4. RENAME AN ACTIVITY WHOSE PLACE LATER GETS A BETTER NAME. When the AllTrails /
--    geocoding pass improves a place's name, every activity there that is still
--    carrying the OLD place name follows it. Anything a person wrote stays put.
create or replace function public.rename_activities_for_place(p_place uuid, p_old_name text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_new text; v_n integer;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select nullif(btrim(name), '') into v_new from public.places where id = p_place;
  if v_new is null then return 0; end if;

  update public.activities a
     set name = v_new
   where a.place_id = p_place
     and a.name is distinct from v_new
     and (public.is_generic_activity_name(a.name)
          or (p_old_name is not null and btrim(a.name) = btrim(p_old_name)));
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.rename_activities_for_place(uuid, text) from public;
revoke all on function public.rename_activities_for_place(uuid, text) from anon;
grant execute on function public.rename_activities_for_place(uuid, text) to authenticated;

commit;
