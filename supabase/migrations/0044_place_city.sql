-- A real city/locality column so trips can group members by city reliably
-- (instead of parsing the address string on the client each render).
alter table places add column if not exists city text;

-- ⚠️ ORDER-DEPENDENT, GUARDED 2026-08-11.
--
-- This backfill reads places.address, which THIS chain does not create until 0098
-- ("Reconcile schema drift: places.address ... exist in production but no migration
-- creates them"). Production had the column already — it drifted in outside the
-- migrations — so 0044 ran fine there. A FRESH database does not, so applying the
-- chain in order raised `column pl.address does not exist`, and scripts/db-bootstrap.sh
-- carried a special case tolerating exactly this one error.
--
-- Guarding it removes that special case: on a fresh database the backfill is skipped
-- (there are no rows to backfill anyway), and 0098 goes on to create the column. On
-- any database that already has the column the behaviour is byte-for-byte what it
-- always was. The end state is identical either way; only the error goes away.
--
-- ROLLBACK: unwrap the DO block — the statement inside is unchanged.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'places' and column_name = 'address'
  ) then
  -- Backfill: the address token immediately before the state (admin1), matching
  -- the client cityOf() parser. e.g. "1700 Cabrillo Dr, San Diego, California 92106,
  -- United States" → "San Diego".
  with parts as (
    select pl.id, pl.admin1, trim(p.part) as part, p.ord
    from places pl,
         unnest(string_to_array(pl.address, ',')) with ordinality as p(part, ord)
    where pl.address is not null and pl.admin1 is not null
  ),
  state_pos as (
    select id, min(ord) as sord
    from parts
    where lower(part) like lower(admin1) || '%'
    group by id
  )
  update places pl
  set city = pc.part
  from state_pos sp
  join parts pc on pc.id = sp.id and pc.ord = sp.sord - 1
  where pl.id = sp.id and pc.part <> '' and sp.sord > 1;
  end if;
end $$;
