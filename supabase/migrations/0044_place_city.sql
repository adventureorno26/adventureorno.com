-- A real city/locality column so trips can group members by city reliably
-- (instead of parsing the address string on the client each render).
alter table places add column if not exists city text;

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
