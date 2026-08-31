-- 0297 — the fog belongs to one space.
--
-- APPLIED TO PRODUCTION 2026-08-31, through `apply-migration.mjs`. Rehearsed against
-- production first inside a transaction forced to abort, with the areas MEASURED inside that
-- transaction and the rollback proven afterwards (single-row CHECK back, 1 fog row, 96,662
-- km² unchanged, no ledger row).
--
-- IT USED TO SAY: "DRAFT — NOT APPLIED. Nothing in this file has been run against production."
--
-- THE ONE VISIBLE CHANGE, measured before applying rather than discovered afterwards:
--
--   Erica's fog   96,662 km²  ->  95,776 km²   (-886 km², 0.9%)
--   Josh's fog    no row      ->   9,498 km²
--
-- She loses the ground only Josh had uncovered, which was never hers. Most of his overlaps
-- hers, which is what 108 both-tagged visits should look like. Verified after applying: the
-- nightly job runs green (`{"spaces": 2}`) where it failed at 07:10 today, and each account
-- reads its own fog through RLS.
--
-- ---------------------------------------------------------------------------
-- TWO FAULTS, ONE ROW
-- ---------------------------------------------------------------------------
--
-- `revealed_area` is the fog-of-war layer: the part of the map you have uncovered. It holds
-- **one row**, `id = 1`, enforced by `CHECK (id = 1)`, and `rebuild_revealed_area()` fills it
-- by unioning **every** photo, location ping and activity in the database.
--
-- That was right while there was one household. After the fork it is two faults at once.
--
-- **1. It fails every night.** Measured on production, from `cron.job_run_details`:
--
-- ```
-- 08-31 07:10  rebuild-revealed-area  failed
--   ERROR: null value in column "space_id" of relation "revealed_area"
--          violates not-null constraint
-- ```
--
-- `0295` cannot help it: `revealed_area` has no owning-profile column and no foreign key to
-- anything that has a space, so there is nothing on the row to resolve from — `0295`'s header
-- names it for exactly this reason. And the `on conflict (id) do update` does NOT save it,
-- which is worth writing down because it is counter-intuitive: Postgres evaluates column
-- defaults and NOT NULL on the proposed tuple **before** conflict resolution, so the insert
-- dies before the `do update` is ever considered.
--
-- **2. If it had succeeded, it would have leaked.** The union has no space in it, so the one
-- row — currently filed in Erica's space — would have been filled with Josh's photos, pings
-- and activities as well, and `revealed_area_geojson()` would have drawn his travel as
-- uncovered ground on her map. The nightly failure is the only reason that has not happened.
-- **A job failing is not a boundary.**
--
-- ---------------------------------------------------------------------------
-- THE SHAPE THIS SHOULD HAVE HAD
-- ---------------------------------------------------------------------------
--
-- One row per space, each built only from that space's own rows. The read side already
-- expects this and was ready before the write side was: the policy is
-- `revealed_area_read USING (is_member(space_id))`, and `revealed_area_geojson()` is
-- SECURITY INVOKER, so RLS already restricts a caller to their own space. The only thing
-- standing in the way was `where id = 1`, hard-coded in the reader, and the CHECK that made
-- a second row impossible.
--
-- `revealed_area_geojson()` becomes an ST_Union over the rows the caller can see, which is
-- the honest answer for 0, 1 or several: someone in two spaces sees the union of their own
-- fog, and someone in none gets NULL — which `fetchFog()` already handles (`d?.crisp ?? null`,
-- `app/src/lib/data.ts:1644`).
--
-- NOT A NEW POLICY. `0292` split the data by "a row goes to the space of whoever is tagged on
-- it"; this derives the fog from rows that are already in a space. It invents nothing.
begin;

-- ---------------------------------------------------------------------------
-- 1. A second row becomes possible, and a second row for the SAME space does not.
--
--    `id` kept rather than replaced by `space_id` as the key: three other functions read
--    this table (`export_manifest`, `export_section`, `cluster_now`) and none of them
--    assumes `id = 1` — only the reader did — so leaving the column alone is the smaller
--    change. Its default of literal `1` becomes a sequence, since there is now more than one.
-- ---------------------------------------------------------------------------
alter table public.revealed_area drop constraint if exists revealed_area_single;

create sequence if not exists public.revealed_area_id_seq owned by public.revealed_area.id;
select setval('public.revealed_area_id_seq',
              coalesce((select max(id) from public.revealed_area), 0) + 1, false);
alter table public.revealed_area alter column id set default nextval('public.revealed_area_id_seq');

alter table public.revealed_area drop constraint if exists revealed_area_one_per_space;
alter table public.revealed_area add constraint revealed_area_one_per_space unique (space_id);

-- ---------------------------------------------------------------------------
-- 2. The rebuild asks the question once per space.
--
--    The geometry maths is 0045's and is deliberately unchanged — 10km buffers unioned,
--    simplified at 0.01, stored as a MULTIPOLYGON. What changes is the FROM: each of the
--    three sources is filtered to the space being built, and the upsert keys on `space_id`.
--
--    A space with nothing in it still gets a row, holding an empty multipolygon. That is
--    deliberate: "you have uncovered nothing" and "we have not looked" are different
--    answers, and a missing row would make them identical on screen.
-- ---------------------------------------------------------------------------
create or replace function public.rebuild_revealed_area()
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare
  s       record;
  g       geometry;
  started timestamptz := now();
  n_space integer := 0;
begin
  for s in select id from public.spaces order by id loop
    select ST_Union(b) into g
      from (
        select ST_Buffer(pt::geography, 10000)::geometry as b
          from (
            select geom::geometry as pt from public.photos
             where geom is not null and space_id = s.id
            union all
            select geom::geometry from public.location_pings
             where geom is not null and space_id = s.id
            union all
            select ST_SetSRID(ST_MakePoint(lng, lat), 4326)
              from public.activities
             where lat is not null and lng is not null and space_id = s.id
          ) pts
      ) u;

    if g is not null then
      g := ST_SimplifyPreserveTopology(g, 0.01);
    end if;

    insert into public.revealed_area (geom, updated_at, space_id)
    values (ST_Multi(coalesce(g, ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)))::geography,
            now(), s.id)
    on conflict (space_id) do update
      set geom = excluded.geom, updated_at = excluded.updated_at;

    n_space := n_space + 1;
  end loop;

  insert into public.job_runs (job, started_at, finished_at, summary)
  values ('rebuild_revealed_area', started, now(),
          jsonb_build_object('spaces', n_space));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The reader stops naming row 1.
--
--    RLS does the scoping (`is_member(space_id)`), and this function is SECURITY INVOKER so
--    that is not bypassed. ST_Union over the visible rows is what makes it correct for a
--    member of two spaces instead of raising "more than one row returned by a subquery".
-- ---------------------------------------------------------------------------
create or replace function public.revealed_area_geojson()
returns jsonb language sql stable set search_path to 'public' as $fn$
  select jsonb_build_object(
           'crisp', ST_AsGeoJSON(ST_Union(geom::geometry))::jsonb,
           'soft',  ST_AsGeoJSON(ST_Buffer(ST_Union(geom::geometry)::geography, 15000)::geometry)::jsonb)
    from public.revealed_area;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. What must be true, checked rather than assumed.
-- ---------------------------------------------------------------------------
do $do$
declare n integer;
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.revealed_area'::regclass and conname = 'revealed_area_single') then
    raise exception '0297: the single-row CHECK is still there';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.revealed_area'::regclass and conname = 'revealed_area_one_per_space') then
    raise exception '0297: nothing stops a space having two fog rows';
  end if;

  -- The reader must not name a row number any more.
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace nn on nn.oid = p.pronamespace
       where nn.nspname = 'public' and p.proname = 'revealed_area_geojson') like '%id=1%' then
    raise exception '0297: revealed_area_geojson still hard-codes id=1';
  end if;

  -- Build it now, so the failing nightly job is not what discovers a mistake here.
  perform public.rebuild_revealed_area();

  select count(*) into n from public.revealed_area;
  if n <> (select count(*) from public.spaces) then
    raise exception '0297: % fog row(s) for % space(s)', n, (select count(*) from public.spaces);
  end if;
  raise notice '0297: one fog row per space — % of them, each built from its own rows', n;
end
$do$;

commit;
