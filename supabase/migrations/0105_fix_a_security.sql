-- 0105 — Fix Migration A (audit 2026-07-29). APPLIED TO PRODUCTION 2026-07-29
-- via Supabase MCP (recorded as fix_a_security_guards_views_lockdown). Commit
-- this file so the repo chain matches prod; re-applying is a no-op (idempotent).
--
-- 1. assert_member() helper + guard injected as the first statement of the 20
--    client-called, previously-unguarded SECURITY DEFINER read RPCs (the 0093
--    backlog item). Non-member authenticated sessions now get 42501.
-- 2. Grant-preserving lockdown: explicit authenticated grants where access
--    exists today, then strip PUBLIC + anon from every SECDEF function; trigger-
--    returning functions stripped from authenticated too. Closes the 0101
--    regression class (new SECDEF fns default-granting to PUBLIC).
-- 3. Internal-only fns (ensure_visit, assign_activity_place, place_for_activity,
--    migrate_container_place_trips, promote_trip_stops_for_place) revoked from
--    all client roles — their callers are SECDEF triggers/functions + service
--    paths (verified). place_is_saved deliberately KEPT for authenticated: it
--    is evaluated inside the photos_select RLS policy with caller privileges.
-- 4. activity_mileage + place_counts: security_invoker = true, anon revoked —
--    closes the unauthenticated aggregate-data read.
-- Residual (accepted): st_estimatedextent is supabase_admin-owned (PostGIS);
-- its anon grant cannot be revoked from the migration role. Coarse bbox only.

create or replace function public.assert_member()
returns void
language plpgsql
stable
set search_path to 'public'
as $$
begin
  if not public.is_member() then
    raise exception 'members only' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.assert_member() from anon;
grant execute on function public.assert_member() to authenticated, service_role;

do $do$
declare r record; newdef text;
begin
  for r in
    select p.oid, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in (
        'climbing_stats','date_night_pick','geo_coverage','last_automated_upload',
        'map_people','mileage_by_person','peaks_bagged','place_days',
        'place_ids_for_view','place_people','place_ratings_for','race_stats',
        'races_list','settings_stats','spatial_members','strava_athletes',
        'strava_connected','tracking_status','wander_stats','wishes_overview')
  loop
    if r.def like '%assert_member%' then continue; end if;
    newdef := regexp_replace(r.def, '\$function\$',
                             '$function$' || E'\n  select public.assert_member();\n');
    execute newdef;
  end loop;
end $do$;

do $do$
declare r record;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.prorettype::regtype::text as ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    if r.ret <> 'trigger' and has_function_privilege('authenticated', r.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.ret = 'trigger' then
      execute format('revoke execute on function %s from authenticated', r.sig);
    end if;
  end loop;
end $do$;

revoke execute on function public.ensure_visit(uuid, date) from public, anon, authenticated;
revoke execute on function public.assign_activity_place(double precision, double precision) from public, anon, authenticated;
revoke execute on function public.place_for_activity(double precision, double precision, text, text) from public, anon, authenticated;
revoke execute on function public.migrate_container_place_trips() from public, anon, authenticated;
revoke execute on function public.promote_trip_stops_for_place(uuid) from public, anon, authenticated;

alter view public.activity_mileage set (security_invoker = true);
alter view public.place_counts set (security_invoker = true);
revoke all on public.activity_mileage from anon;
revoke all on public.place_counts from anon;
