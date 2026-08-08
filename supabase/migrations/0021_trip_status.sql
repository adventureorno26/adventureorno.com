-- My Trips has three buckets: Trips Taken vs Upcoming Trips (Bucket List lives in
-- the places table). `status` lets the owner move a trip between Taken/Upcoming
-- explicitly rather than inferring purely from dates.
alter table trips add column if not exists status text not null default 'taken'
  check (status in ('taken', 'upcoming'));

-- Seed existing rows: anything starting in the future is upcoming.
update trips set status = 'upcoming' where start_date > current_date;
