-- "On this day, N years ago": photos taken on today's month/day in a prior year,
-- joined to their place for a one-tap jump. SECURITY INVOKER so RLS still applies.
create or replace function on_this_day()
returns table (photo_id uuid, place_id uuid, place_name text, taken_at timestamptz)
language sql
stable
as $$
  select p.id, p.place_id, pl.name, p.taken_at
  from photos p
  join places pl on pl.id = p.place_id
  where p.taken_at is not null
    and to_char(p.taken_at, 'MM-DD') = to_char(now(), 'MM-DD')
    and p.taken_at < date_trunc('year', now())
  order by p.taken_at desc;
$$;
