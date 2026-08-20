-- 0226 — name it from the source or the place, and only ask when there is real doubt.
--
-- Erica, 2026-08-18: *"it should populate where there are random letters now the Name of the
-- activity from the source or the location of the source, then ask me to approve it only if
-- there is some doubt."*
--
-- `activity_display_name` already had the right SHAPE — what a person wrote, else the place,
-- else the type. The gap was in what counts as "what a person wrote". Measured across all
-- 547 activities:
--
--     353  named after their place        ← the rule working
--     129  a real name a person typed     ← "Training Run - 14 miles"
--      58  "<X> County Running"           ← Garmin's auto-name, and NOT a person's words
--       7  "Morning Hike"                 ← Strava's auto-name, already caught
--
-- Garmin names an activity after the ADMINISTRATIVE AREA it happened in — "Loudoun County
-- Running" fifty-five times over. That is a machine's words, not hers, and the place it
-- actually happened (Broadlands, Potomac Station, Sterling, Bear's Den) is strictly better.
--
-- WHY THE PATTERN IS NARROW, and it was measured before it was chosen. Every name ending in
-- a bare gerund is machine-made, but not every one has a better alternative:
--
--     "Bay Lake Running"        → its place is "Cake Bake Shop Restaurant"
--     "Track Meet Running"      → its place is "Sterling"
--     "Purcellville Running"    → its place is "Purcellville Trailhead - W&OD"
--
-- Renaming the first would be a clear loss. So this matches only the unambiguous
-- administrative form — `<something> County|City <gerund>` — which is 58 rows, every one of
-- which has a properly named place waiting. The other three keep their names; if they are
-- wrong, they are wrong in a way a person should decide.
--
-- AND THE DOUBTFUL ONES ARE NOT WHAT THEY LOOK LIKE. Eight activities are generic AND have
-- nothing better to fall back on. Reading them:
--
--     5  Josh's, at a place still called "New place", WITH coordinates
--     3  Erica's, with NO coordinates at all — 0.06 / 0.21 / 3.08 mi, indoor
--
-- The five are the **unnamed-place** problem wearing an activity costume: name the place and
-- the activity names itself. They belong to the "Unnamed places" queue that already exists,
-- not to eight new activity cards. The three cannot be named by anything but her, and a card
-- asking her to name a 0.06-mile walk is noise, not review. So this migration raises **no
-- cards at all** — which is the point of "only if there is some doubt".

-- ---------------------------------------------------------------------------
-- 1. A machine's geography is not a name.
-- ---------------------------------------------------------------------------
create or replace function public.is_generic_activity_name(p_name text)
returns boolean
language sql
immutable
as $function$
  select case
    when btrim(coalesce(p_name, '')) = '' then true
    -- Strava's own defaults: "Morning Walk", "Lunch Run", "Night Hike"…
    when btrim(p_name) ~*
      '^(morning|afternoon|evening|night|lunch|late[ -]?night)[ _-]+(walk|run|hike|ride|swim|workout|activity|jog|cycle)s?$'
      then true
    -- GARMIN'S DEFAULT: the administrative area plus the sport. "Loudoun County Running"
    -- appears 55 times in this database. Deliberately requires County or City — a bare
    -- "<place> Running" can be the best name there is ("Bay Lake Running", whose place is
    -- recorded as a cake shop).
    when btrim(p_name) ~* '\m(county|city)\s+(running|walking|hiking|cycling|biking|swimming)$'
      then true
    -- Bulk-export filenames from Garmin and Strava.
    when btrim(p_name) ~* '^(hiking|running|cycling|walking|swimming|activity|workout)[ _-]*\d{4}-\d{2}-\d{2}' then true
    when btrim(p_name) ~  '^\d{4}-\d{2}-\d{2}[ T_-]' then true
    when btrim(p_name) ~* '^activity_?\d+$' then true
    -- A bare type says nothing either.
    when btrim(p_name) ~* '^(walk|run|hike|ride|swim|workout|activity)$' then true
    else false
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Apply it to what is already here — but only where something better exists.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  update public.activities a
     set name = pl.name
    from public.places pl
   where pl.id = a.place_id
     and public.is_generic_activity_name(a.name)
     and coalesce(nullif(btrim(pl.name), ''), 'New place') <> 'New place'
     and a.name is distinct from pl.name;
  get diagnostics n = row_count;
  raise notice '0226: renamed % activities after the place they happened at', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. When a place is renamed, the activities that took its name follow it.
-- ---------------------------------------------------------------------------
-- 353 activities are "named after their place" BY VALUE — a copy of the place's name taken
-- at import. Rename the place and every one of them keeps the old text, which is this
-- repository's oldest recurring bug (§"Derived vs source") in a place nobody had looked.
-- Only rows that were actually FOLLOWING the place move; a name a person typed is theirs.
create or replace function public.apply_inbox_field(p_type text, p_id uuid, p_field text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  prev jsonb;
  old_place uuid;
  new_place uuid;
  old_name text;
begin
  if p_type = 'activity' and p_field = 'name' then
    select to_jsonb(a.name) into prev from public.activities a where a.id = p_id;
    update public.activities set name = p_value #>> '{}' where id = p_id;

  elsif p_type = 'activity' and p_field = 'place_id' then
    select to_jsonb(a.place_id), a.place_id into prev, old_place
      from public.activities a where a.id = p_id;
    new_place := nullif(p_value #>> '{}', '')::uuid;
    update public.activities set place_id = new_place where id = p_id;
    if old_place is not null then
      perform public.recompute_place_stats(old_place);
      perform public.rebuild_place_visits(old_place);
    end if;
    if new_place is not null then
      perform public.recompute_place_stats(new_place);
      perform public.rebuild_place_visits(new_place);
    end if;

  elsif p_type = 'activity' and p_field = 'shared_group_id' then
    select to_jsonb(a.shared_group_id) into prev from public.activities a where a.id = p_id;
    update public.activities
       set shared_group_id = nullif(p_value #>> '{}', '')::uuid
     where id = p_id;

  elsif p_type = 'place' and p_field = 'name' then
    select to_jsonb(p.name), p.name into prev, old_name from public.places p where p.id = p_id;
    update public.places set name = p_value #>> '{}' where id = p_id;
    -- THE ACTIVITIES THAT TOOK THIS NAME FOLLOW IT.
    update public.activities a
       set name = p_value #>> '{}'
     where a.place_id = p_id
       and (a.name is not distinct from old_name
            or public.is_generic_activity_name(a.name));

  elsif p_type = 'place' and p_field = 'is_trail' then
    select to_jsonb(p.is_trail) into prev from public.places p where p.id = p_id;
    update public.places set is_trail = (p_value #>> '{}')::boolean where id = p_id;

  elsif p_type = 'visit' and p_field = 'place_id' then
    select to_jsonb(v.place_id) into prev from public.visits v where v.id = p_id;
    update public.visits set place_id = (p_value #>> '{}')::uuid where id = p_id;

  elsif p_type = 'visit' and p_field = 'is_trip' then
    select to_jsonb(v.trip_marked) into prev from public.visits v where v.id = p_id;
    update public.visits set trip_marked = (p_value #>> '{}')::boolean where id = p_id;

  elsif p_type = 'photo' and p_field = 'visit_id' then
    select to_jsonb(ph.visit_id) into prev from public.photos ph where ph.id = p_id;
    update public.photos set visit_id = nullif(p_value #>> '{}', '')::uuid where id = p_id;

  else
    raise exception 'the inbox does not write %.%', p_type, p_field using errcode = '22023';
  end if;

  return prev;
end
$function$;

comment on function public.is_generic_activity_name is
  'True when a name is a MACHINE''s words rather than a person''s: Strava''s "Morning Hike", '
  'Garmin''s "<X> County Running" (55 rows), export filenames, a bare type. Narrow on '
  'purpose — "Bay Lake Running" stays, because its place is recorded as a cake shop (0226).';
