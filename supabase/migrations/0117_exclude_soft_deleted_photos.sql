-- 0117 — Exclude soft-deleted photos from visit rebuilding + place stats (Prompt 4,
-- rec 20: "exclude soft-deleted evidence from counts").
--
-- photos is the only soft-deletable evidence table (deleted_at); videos/activities/
-- entries/location_pings hard-delete. Three SECURITY DEFINER functions read photos
-- WITHOUT a deleted_at filter, so a soft-deleted photo would still create/extend a
-- visit, inflate visit_count, or even be chosen as a place's cover:
--   * rebuild_place_visits  (the canonical visit builder)
--   * recompute_place_stats (first/last visit, visit_count, cover_photo_id)
--   * place_days            (the per-day evidence breakdown)
-- (place_visit_stats and data_health already filter deleted_at.) These are the exact
-- current definitions with `and deleted_at is null` added to every photo read; no
-- other logic changed. Idempotent-safe: rebuild remains reconciliation over visits.
--
-- ROLLBACK: recreate the three functions without the deleted_at filters (git history).

create or replace function public.rebuild_place_visits(p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_josh uuid := (select id from public.profiles where display_name = 'Josh' limit 1);
  v_erica uuid := (select id from public.profiles where role = 'owner'
                   and coalesce(display_name,'') !~* '(test|bot)' limit 1);
  v_cutoff constant date := '2025-12-21';
begin
  if p_place is null then return; end if;

  create temp table _isl on commit drop as
  with days as (
    select coalesce(taken_at, created_at)::date d from public.photos
      where place_id = p_place and deleted_at is null and coalesce(taken_at, created_at) is not null
    union select start_date::date from public.activities
      where place_id = p_place and start_date is not null
    union select recorded_at::date from public.location_pings where place_id = p_place
    union select date::date from public.entries
      where place_id = p_place and date is not null
    union select a.start_date::date from public.activities a
      join public.places mp on mp.id = a.place_id
      where a.start_date is not null and mp.id <> p_place and (
        p_place = any(mp.part_of)
        or exists (select 1 from public.places c where c.id = p_place
                   and c.boundary is not null and mp.geom is not null
                   and st_contains(c.boundary::geometry, mp.geom::geometry)))
    union select coalesce(ph.taken_at, ph.created_at)::date from public.photos ph
      join public.places mp on mp.id = ph.place_id
      where ph.deleted_at is null and coalesce(ph.taken_at, ph.created_at) is not null and mp.id <> p_place and (
        p_place = any(mp.part_of)
        or exists (select 1 from public.places c where c.id = p_place
                   and c.boundary is not null and mp.geom is not null
                   and st_contains(c.boundary::geometry, mp.geom::geometry)))
    union select e.date::date from public.entries e
      join public.places mp on mp.id = e.place_id
      where e.date is not null and mp.id <> p_place and p_place = any(mp.part_of)
  ),
  dd  as (select distinct d from days),
  grp as (select d, d - (row_number() over (order by d))::int as isl from dd)
  select min(d) as s, max(d) as e from grp group by isl;

  create temp table _isln on commit drop as
  select i.s, i.e,
    (select string_agg(v.note, ' / ' order by v.start_date) from public.visits v
       where v.place_id = p_place and not v.manual and v.note is not null
         and v.start_date <= i.e and v.end_date >= i.s) as note,
    exists (select 1 from public.visits v
       where v.place_id = p_place and not v.manual and v.solo_override
         and v.start_date <= i.e and v.end_date >= i.s) as ovr,
    (select v.solo_profile from public.visits v
       where v.place_id = p_place and not v.manual and v.solo_override
         and v.start_date <= i.e and v.end_date >= i.s
       order by v.start_date limit 1) as ovr_profile,
    (with a as (
        select count(*) n,
               array_agg(distinct owner_profile) filter (where owner_profile is not null) owners
        from public.activities
          where place_id = p_place and start_date::date between i.s and i.e)
     select case
       when a.n > 0 and a.owners = array[v_josh] then v_josh
       when i.s < v_cutoff then v_erica
       else null end
     from a) as inferred
  from _isl i;

  create temp table _match on commit drop as
  select n.s, n.e, n.note, n.ovr, n.ovr_profile, n.inferred,
    (select v.id from public.visits v
       where v.place_id = p_place and not v.manual
         and v.start_date <= n.e and v.end_date >= n.s
       order by (least(v.end_date, n.e) - greatest(v.start_date, n.s)) desc, v.start_date, v.id
       limit 1) as reuse_id
  from _isln n;
  update _match m set reuse_id = null
   where reuse_id is not null
     and exists (select 1 from _match m2 where m2.reuse_id = m.reuse_id and (m2.s, m2.e) < (m.s, m.e));

  update public.visits v
     set start_date = m.s, end_date = m.e, note = m.note,
         solo_profile = case when m.ovr then m.ovr_profile else m.inferred end,
         solo_override = m.ovr
  from _match m where v.id = m.reuse_id;

  delete from public.visits v
   where v.place_id = p_place and not v.manual
     and not exists (select 1 from _match m where m.reuse_id = v.id);

  insert into public.visits (place_id, start_date, end_date, note, solo_profile, solo_override)
    select p_place, m.s, m.e, m.note,
           case when m.ovr then m.ovr_profile else m.inferred end, m.ovr
    from _match m where m.reuse_id is null;

  drop table if exists _isl;
  drop table if exists _isln;
  drop table if exists _match;

  perform public.promote_trip_stops_for_place(p_place);
end $function$;

create or replace function public.recompute_place_stats(p_place uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first date;
  v_last  date;
  v_count integer;
  v_cover uuid;
begin
  with days as (
    select taken_at::date as d from public.photos
      where place_id = p_place and deleted_at is null and taken_at is not null
    union
    select recorded_at::date from public.location_pings where place_id = p_place
    union
    select start_date::date from public.activities where place_id = p_place and start_date is not null
  )
  select min(d), max(d), count(*) into v_first, v_last, v_count from days;

  -- Keep the existing cover if it still belongs to this place (manual choice) and
  -- hasn't been soft-deleted.
  select cover_photo_id into v_cover from public.places where id = p_place;
  if v_cover is not null
     and not exists (select 1 from public.photos where id = v_cover and place_id = p_place and deleted_at is null) then
    v_cover := null;
  end if;
  if v_cover is null then
    select id into v_cover from public.photos
      where place_id = p_place and deleted_at is null and is_landscape order by taken_at desc nulls last limit 1;
    if v_cover is null then
      select id into v_cover from public.photos
        where place_id = p_place and deleted_at is null order by taken_at desc nulls last limit 1;
    end if;
  end if;

  update public.places
     set first_visit = least(first_visit, v_first),
         last_visit  = greatest(last_visit, v_last),
         visit_count = coalesce(v_count, visit_count),
         cover_photo_id = v_cover,
         activity_categories = coalesce(
           (select array_agg(distinct public.activity_category(type))
              from public.activities where place_id = p_place and type is not null), '{}')
   where id = p_place;
end;
$function$;

create or replace function public.place_days(p_place uuid)
returns table(day date, activities integer, entries integer, photos integer, pings integer, label text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with d as (
    select start_date::date as day, 'a' as kind
      from public.activities where place_id = p_place and start_date is not null
    union all
    select date, 'e' from public.entries where place_id = p_place and date is not null
    union all
    select taken_at::date, 'p' from public.photos where place_id = p_place and deleted_at is null and taken_at is not null
    union all
    select recorded_at::date, 'g'
      from public.location_pings where place_id = p_place
  ),
  grouped as (
    select
      day,
      count(*) filter (where kind = 'a')::int as activities,
      count(*) filter (where kind = 'e')::int as entries,
      count(*) filter (where kind = 'p')::int as photos,
      count(*) filter (where kind = 'g')::int as pings
    from d group by day
  )
  select
    g.*,
    (select a.name from public.activities a
       where a.place_id = p_place and a.start_date::date = g.day and a.name is not null
       order by a.start_date desc limit 1) as label
  from grouped g
  order by g.day desc;
$function$;
