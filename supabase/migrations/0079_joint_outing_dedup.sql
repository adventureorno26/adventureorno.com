-- 0079_joint_outing_dedup.sql — when Erica AND Josh both log the SAME outing
-- (they hiked/ran/biked together, watches slightly off), it's ONE shared outing,
-- not two. Rule: same calendar day + same type + start within 800 m + distance
-- within 0.5 mi (804 m). Keep one copy, mark it "Both" (solo_profile=null so it
-- counts once for each of them), drop the other. Two layers:
--   1. import_file_activity: dedup at INGEST (Josh's file import matching Erica's
--      existing Strava/activity → mark hers Both, don't create a duplicate).
--   2. dedupe_joint_outings(): nightly backstop for anything that slips through
--      (e.g. Erica's Strava arriving AFTER Josh's import).

create or replace function public.import_file_activity(
  p_name text, p_type text, p_polyline text, p_distance double precision,
  p_moving integer, p_lat double precision, p_lng double precision,
  p_date timestamp with time zone
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_place uuid;
  v_id uuid;
  v_cutoff constant date := '2025-12-21';
  v_pt geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
begin
  -- Same-person dup (Garmin vs Strava, GPS variance).
  select id into v_id from public.activities
   where owner_profile = v_me
     and abs(extract(epoch from (start_date - p_date))) < 600
     and (type = p_type
          or abs(coalesce(distance,0) - coalesce(p_distance,0)) < greatest(80, coalesce(p_distance,0)*0.06))
   limit 1;
  if v_id is not null then return v_id; end if;

  -- Cross-person JOINT outing: the OTHER member already logged this same outing →
  -- one shared outing. Mark theirs Both and don't create a duplicate.
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
    (null, p_type, p_name, coalesce(p_distance, 0), p_moving, p_date, p_lat, p_lng,
     v_place, p_polyline, 'file', v_me,
     case when p_date < v_cutoff then v_me else null end)
  returning id into v_id;
  if v_place is not null then
    perform public.recompute_place_stats(v_place);
    perform public.rebuild_place_visits(v_place);
  end if;
  return v_id;
end $$;

-- Nightly backstop: collapse any Erica+Josh joint-outing pairs. Keeps the OWNER's
-- copy (better place names), marks it Both, deletes the editor's duplicate.
create or replace function public.dedupe_joint_outings()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := (select id from public.profiles where role='owner'
                   and coalesce(display_name,'') !~* '(test|bot)' limit 1);
  r record; v_n int := 0;
begin
  for r in
    select o.id keep_id, x.id drop_id, o.place_id o_pl, x.place_id x_pl
    from public.activities o
    join public.activities x
      on o.owner_profile = v_owner and x.owner_profile is not null and x.owner_profile <> v_owner
     and o.type = x.type and o.start_date::date = x.start_date::date
     and o.geom is not null and x.geom is not null and st_dwithin(o.geom, x.geom, 800)
     and abs(coalesce(o.distance,0) - coalesce(x.distance,0)) <= 804
  loop
    if not exists (select 1 from public.activities where id = r.drop_id) then continue; end if;
    update public.activities set solo_profile = null where id = r.keep_id;
    delete from public.activities where id = r.drop_id;
    perform public.recompute_place_stats(r.o_pl), public.rebuild_place_visits(r.o_pl);
    if r.x_pl is not null and r.x_pl <> r.o_pl then
      perform public.recompute_place_stats(r.x_pl), public.rebuild_place_visits(r.x_pl);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
grant execute on function public.dedupe_joint_outings() to service_role;

select cron.schedule('dedupe-joint-outings', '20 4 * * *',
  $$select public.dedupe_joint_outings();$$)
where not exists (select 1 from cron.job where jobname = 'dedupe-joint-outings');
