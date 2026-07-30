-- DB test for migration 0106: coordinate-free activities store unplaced and count
-- toward mileage, but never carry a place or a route. LOCAL disposable stack only.

begin;

-- A coordinate-free activity (no lat/lng, no place) with real distance stores.
insert into public.activities (type, distance, start_date, lat, lng, place_id, summary_polyline)
values ('Run', 1609.344, '2026-06-01T10:00:00Z', null, null, null, null);

do $$
begin
  if not exists (
    select 1 from public.activities
    where type = 'Run' and distance = 1609.344
      and lat is null and lng is null and place_id is null and summary_polyline is null
  ) then
    raise exception 'FAIL: coordinate-free activity was not stored unplaced';
  end if;
  -- It contributes to a plain mileage sum (mileage never filters by place/geom).
  if (select round(sum(distance) / 1609.344) from public.activities where lat is null) < 1 then
    raise exception 'FAIL: coordinate-free activity does not count toward mileage';
  end if;
  -- It carries no route, so the map query (summary_polyline not null) excludes it.
  if exists (select 1 from public.activities where lat is null and summary_polyline is not null) then
    raise exception 'FAIL: coordinate-free activity unexpectedly has a route';
  end if;
end $$;

do $$ begin raise notice 'PASS: coordinate-free activities store unplaced + counted'; end $$;

rollback;
