-- Generic multi-container membership: a place can be "part of" several places at
-- once (e.g. a hike that is on the Appalachian Trail AND during a San Diego trip).
-- Replaces the single-parent `trail_id` link. trail_id is kept for now (legacy)
-- but the app reads/writes `part_of`.
alter table places add column if not exists part_of uuid[] not null default '{}';

-- Backfill existing single-parent links into the array.
update places
set part_of = array[trail_id]
where trail_id is not null
  and coalesce(array_length(part_of, 1), 0) = 0;
