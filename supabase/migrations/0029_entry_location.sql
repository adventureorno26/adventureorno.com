-- Spots (entries) can carry their own address + coordinates. A restaurant or
-- other spot with a specific address gets its OWN Directions button, while the
-- parent place stays the city that everything clusters under.
alter table entries
  add column if not exists address text,
  add column if not exists lat double precision,
  add column if not exists lng double precision;
