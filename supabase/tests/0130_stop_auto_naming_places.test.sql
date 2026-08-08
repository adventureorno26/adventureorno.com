-- DB test for 0130 — automation no longer names places, and a name belongs to
-- whoever gave it, in the space they gave it in.
begin;

insert into auth.users (id,email) values
  ('cccc3333-0000-0000-0000-00000000e001','v130-erica@example.test'),
  ('cccc3333-0000-0000-0000-00000000e002','v130-josh@example.test') on conflict do nothing;
insert into public.profiles (id,role,display_name) values
  ('cccc3333-0000-0000-0000-00000000e001','owner','V130 Erica'),
  ('cccc3333-0000-0000-0000-00000000e002','editor','Josh') on conflict do nothing;

-- 1+2) THE AUTOMATION IS OFF, AND ONLY IT.
--   The disposable local stack has an empty cron.job (pg_cron is not driven here), so
--   asserting "no geocode job exists" would pass without proving anything — the exact
--   vacuous-test trap that let an earlier nav bug through. Instead: schedule all five
--   real jobs, run the migration's own unschedule statements, and assert precisely the
--   two place-naming jobs are gone and the other three survive.
do $$
declare n int; survivors text;
begin
  perform cron.schedule('geocode-new-places-nightly', '50 * * * *', 'select 1');
  perform cron.schedule('merge-nearby-dupes',         '30 4 * * *', 'select 1');
  perform cron.schedule('dedupe-joint-outings',       '20 4 * * *', 'select 1');
  perform cron.schedule('purge-trash',                '30 4 * * *', 'select 1');
  perform cron.schedule('rebuild-revealed-area',      '10 7 * * *', 'select 1');

  -- verbatim from 0130
  perform cron.unschedule('geocode-new-places-nightly')
    where exists (select 1 from cron.job where jobname = 'geocode-new-places-nightly');
  perform cron.unschedule('merge-nearby-dupes')
    where exists (select 1 from cron.job where jobname = 'merge-nearby-dupes');

  select count(*) into n from cron.job
   where jobname in ('geocode-new-places-nightly','merge-nearby-dupes');
  if n <> 0 then raise exception 'FAIL: % place-automation job(s) still scheduled', n; end if;

  select count(*), string_agg(jobname, ', ' order by jobname) into n, survivors
    from cron.job where jobname in ('dedupe-joint-outings','purge-trash','rebuild-revealed-area');
  if n <> 3 then raise exception 'FAIL: expected 3 unrelated jobs to survive, found % (%)', n, survivors; end if;
  raise notice 'PASS 1: geocoder + dupe-merger unscheduled; % kept', survivors;
end $$;

-- 3) A name given in MY OWN space is mine. Josh cannot change it.
do $$
declare p uuid; ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"cccc3333-0000-0000-0000-00000000e001"}';
  insert into public.places (name, lat, lng, saved, auto) values ('New place', 39.2, -77.5, true, true) returning id into p;
  perform public.set_place_name(p, 'Erica''s Overlook', 'cccc3333-0000-0000-0000-00000000e001');

  set local request.jwt.claims = '{"sub":"cccc3333-0000-0000-0000-00000000e002"}';
  begin
    perform public.set_place_name(p, 'Josh Renamed It', null);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: Josh renamed a place Erica named in her own space'; end if;
  if (select name from public.places where id = p) <> 'Erica''s Overlook' then
    raise exception 'FAIL: the name changed anyway'; end if;
  raise notice 'PASS 3: a personal-space name is only the namer''s to change';
end $$;

-- 4) ...and the namer CAN still change their own.
do $$
declare p uuid;
begin
  set local request.jwt.claims = '{"sub":"cccc3333-0000-0000-0000-00000000e001"}';
  select id into p from public.places where name = 'Erica''s Overlook';
  perform public.set_place_name(p, 'Erica''s Better Overlook', 'cccc3333-0000-0000-0000-00000000e001');
  if (select name from public.places where id = p) <> 'Erica''s Better Overlook' then
    raise exception 'FAIL: Erica could not rename her own place'; end if;
  raise notice 'PASS 4: the namer can rename their own place';
end $$;

-- 5) THE SHARED SPACE. A name given in Both is either of ours.
do $$
declare p uuid;
begin
  set local request.jwt.claims = '{"sub":"cccc3333-0000-0000-0000-00000000e001"}';
  insert into public.places (name, lat, lng, saved, auto) values ('New place', 39.3, -77.6, true, true) returning id into p;
  perform public.set_place_name(p, 'Our Beach', null);          -- named in Both

  set local request.jwt.claims = '{"sub":"cccc3333-0000-0000-0000-00000000e002"}';
  perform public.set_place_name(p, 'Our Best Beach', null);      -- Josh may
  if (select name from public.places where id = p) <> 'Our Best Beach' then
    raise exception 'FAIL: Josh could not rename a shared-space place'; end if;
  raise notice 'PASS 5: in the shared space either of us can rename';
end $$;

-- 6) You cannot name INTO someone else's space and lock them out.
do $$
declare p uuid; ok boolean := false;
begin
  set local request.jwt.claims = '{"sub":"cccc3333-0000-0000-0000-00000000e002"}';
  insert into public.places (name, lat, lng, saved, auto) values ('New place', 39.4, -77.7, true, true) returning id into p;
  begin
    perform public.set_place_name(p, 'Stolen', 'cccc3333-0000-0000-0000-00000000e001');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: Josh named a place into Erica''s space'; end if;
  raise notice 'PASS 6: you can only name in your own space or the shared one';
end $$;

-- 7) Naming records the owner and stops the geocoder for good.
do $$
declare p uuid; r public.places;
begin
  set local request.jwt.claims = '{"sub":"cccc3333-0000-0000-0000-00000000e001"}';
  insert into public.places (name, lat, lng, saved, auto, needs_geocode)
    values ('New place', 39.5, -77.8, true, true, true) returning id into p;
  r := public.set_place_name(p, 'Chosen By Hand', null);
  if r.named_by <> 'cccc3333-0000-0000-0000-00000000e001' then raise exception 'FAIL: named_by not recorded'; end if;
  if not r.name_locked then raise exception 'FAIL: not locked'; end if;
  if r.needs_geocode then raise exception 'FAIL: still queued for geocoding'; end if;
  raise notice 'PASS 7: naming records the owner and clears needs_geocode';
end $$;

-- 8) Nothing is left queued for a geocoder that no longer runs.
do $$
declare n int;
begin
  select count(*) into n from public.places where needs_geocode;
  if n <> 0 then raise exception 'FAIL: % place(s) still awaiting a geocoder that is off', n; end if;
  raise notice 'PASS 8: no places left waiting on the disabled geocoder';
end $$;

-- 9) A viewer still cannot name anything.
do $$
declare p uuid; ok boolean := false;
begin
  insert into auth.users (id,email) values ('cccc3333-0000-0000-0000-00000000e003','v130-viewer@example.test') on conflict do nothing;
  insert into public.profiles (id,role,display_name) values ('cccc3333-0000-0000-0000-00000000e003','viewer','V130 Viewer') on conflict do nothing;
  select id into p from public.places where name = 'Chosen By Hand';
  set local request.jwt.claims = '{"sub":"cccc3333-0000-0000-0000-00000000e003"}';
  begin
    perform public.set_place_name(p, 'Viewer Rename', null);
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL: a viewer named a place'; end if;
  raise notice 'PASS 9: viewer denied';
end $$;

do $$ begin raise notice 'PASS: 0130 automation off + per-space name ownership'; end $$;
rollback;
