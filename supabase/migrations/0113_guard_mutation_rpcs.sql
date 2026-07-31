-- 0113 — Guard write RPCs so a viewer (or a logged-in non-member) can't mutate
-- through SECURITY DEFINER functions (Prompt 3, authorization matrix).
--
-- Both functions are SECURITY DEFINER granted to `authenticated`, so RLS on the
-- underlying tables does NOT constrain them — the guard must live in the function.
-- A viewer must not import activities or dismiss duplicate places.
--
-- ROLLBACK: recreate each function without the is_editor_or_owner() guard (see the
-- prior definitions in git history / pg_get_functiondef before this migration).

-- dismiss_duplicate: was a plain SQL insert with no authz. Convert to plpgsql with
-- an explicit guard (raises for viewers instead of silently no-op'ing).
create or replace function public.dismiss_duplicate(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.dup_dismissed (place_a, place_b, created_by)
  values (least(p_a, p_b), greatest(p_a, p_b), auth.uid())
  on conflict do nothing;
end
$function$;

-- import_file_activity: identical to its current body, with the guard prepended.
create or replace function public.import_file_activity(
  p_name text, p_type text, p_polyline text, p_distance double precision,
  p_moving integer, p_lat double precision, p_lng double precision,
  p_date timestamp with time zone)
returns uuid
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
end
$function$;
