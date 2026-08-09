-- A visit is a thing you can open, edit and put things into.
--
-- Marking a visit got you a dropdown, two dates and Delete. There was nowhere to
-- put the photos, nowhere to say what you did, and no way to move something that
-- landed wrong. Erica: "what is the fucking point of labeling something a trip
-- unless I can also add all the shit I want to THAT specific visit". This is the
-- backend for the visit page.
--
-- Nothing here removes anything. One nullable column, three functions.

begin;

-- 1. PIN A PHOTO TO A VISIT. Until now a photo belonged to a visit purely because
--    its date fell inside one. That is right almost always, and it is what makes
--    sorting photos into places also sort them by visit — but it cannot express
--    "I am putting this one here". Erica chose: the photo KEEPS its real date and
--    still shows on the visit she put it on. So the link is an override, not a
--    replacement, and it is null for everything that lands by date.
alter table public.photos
  add column if not exists visit_id uuid references public.visits(id) on delete set null;

create index if not exists photos_visit_id_idx on public.photos(visit_id) where visit_id is not null;

-- 2. WHAT IS ON THIS VISIT. One read for the whole page: the visit, its place, the
--    activities that happened during it, and its photos — pinned ones plus the ones
--    whose own local day falls inside it.
create or replace function public.visit_detail(p_visit uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select jsonb_build_object(
    'visit', to_jsonb(v) - 'geom',
    'place', jsonb_build_object(
        'id', p.id, 'name', p.name, 'admin1', p.admin1, 'country', p.country,
        'address', p.address, 'lat', p.lat, 'lng', p.lng, 'is_trail', p.is_trail),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'type', a.type, 'distance', a.distance,
               'elevation_gain', a.elevation_gain, 'moving_time', a.moving_time,
               'local_date', a.local_date, 'start_date', a.start_date,
               'place_id', a.place_id, 'solo_profile', a.solo_profile)
               order by a.start_date)
        from public.activities a
       where a.place_id = v.place_id
         and coalesce(a.local_date, a.start_date::date) between v.start_date and v.end_date
         -- one row per outing: a duplicate recorded twice is still one thing you did
         and a.id = (select a2.id from public.activities a2
                      where coalesce(a2.shared_group_id, a2.id) = coalesce(a.shared_group_id, a.id)
                      order by (a2.summary_polyline is not null) desc,
                               (a2.source = 'strava') desc, a2.id
                      limit 1)), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ph.id, 'taken_at', ph.taken_at, 'local_date', ph.local_date,
               'caption', ph.caption, 'pinned', coalesce(ph.visit_id = v.id, false))
               order by ph.taken_at)
        from public.photos ph
       where ph.deleted_at is null
         and (ph.visit_id = v.id
              or (ph.visit_id is null and ph.place_id = v.place_id
                  and coalesce(ph.local_date, ph.taken_at::date)
                      between v.start_date and v.end_date))), '[]'::jsonb),
    -- For a MARKED trip: the places you went to during it. Derived from the dates
    -- (trip_contents), so it follows the trip if you change them and there is
    -- nothing stored to drift.
    'contents', case when v.is_trip then coalesce((
      select jsonb_agg(jsonb_build_object(
               'place_id', c.place_id, 'place_name', c.place_name,
               'visit_id', c.visit_id, 'start_date', c.start_date, 'end_date', c.end_date)
               order by c.start_date)
        from public.trip_contents(v.id) c), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.visits v
  join public.places p on p.id = v.place_id
  where v.id = p_visit;
$function$;

revoke all on function public.visit_detail(uuid) from public;
revoke all on function public.visit_detail(uuid) from anon;
grant execute on function public.visit_detail(uuid) to authenticated;

-- 3. MOVE A VISIT TO THE RIGHT PLACE. Marks it manual so a later rebuild cannot
--    undo the correction, and rebuilds both places so their dates and counts follow.
create or replace function public.set_visit_place(p_visit uuid, p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_old uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_place is null then raise exception 'a visit needs a place'; end if;
  if not exists (select 1 from public.places where id = p_place) then
    raise exception 'place % not found', p_place;
  end if;

  select place_id into v_old from public.visits where id = p_visit;
  if v_old is null then raise exception 'visit % not found', p_visit; end if;
  if v_old = p_place then return; end if;

  -- manual = true: a person moved this deliberately, so rebuild must not delete it.
  update public.visits set place_id = p_place, manual = true where id = p_visit;

  perform public.recompute_place_stats(v_old);
  perform public.rebuild_place_visits(v_old);
  perform public.recompute_place_stats(p_place);
end $function$;

revoke all on function public.set_visit_place(uuid, uuid) from public;
revoke all on function public.set_visit_place(uuid, uuid) from anon;
grant execute on function public.set_visit_place(uuid, uuid) to authenticated;

-- 4. PUT A PHOTO ON THIS VISIT (or let it go back to falling where its date says).
--    The photo's date is never touched — that was Erica's explicit choice.
create or replace function public.set_photo_visit(p_photo uuid, p_visit uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_place uuid;
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_visit is null then
    update public.photos set visit_id = null where id = p_photo;
    return;
  end if;

  select place_id into v_place from public.visits where id = p_visit;
  if v_place is null then raise exception 'visit % not found', p_visit; end if;

  -- Pinning also moves the photo to that visit's place, or it would be pinned to a
  -- visit it cannot be seen from. The DATE stays exactly as it was.
  update public.photos set visit_id = p_visit, place_id = v_place where id = p_photo;
end $function$;

revoke all on function public.set_photo_visit(uuid, uuid) from public;
revoke all on function public.set_photo_visit(uuid, uuid) from anon;
grant execute on function public.set_photo_visit(uuid, uuid) to authenticated;

-- 5. Editing a visit's note is part of the page.
create or replace function public.set_visit_note(p_visit uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.visits
     set note = nullif(btrim(coalesce(p_note, '')), ''),
         manual = true            -- a written note is a person's work; protect it
   where id = p_visit;
  if not found then raise exception 'visit % not found', p_visit; end if;
end $function$;

revoke all on function public.set_visit_note(uuid, text) from public;
revoke all on function public.set_visit_note(uuid, text) from anon;
grant execute on function public.set_visit_note(uuid, text) to authenticated;

commit;
