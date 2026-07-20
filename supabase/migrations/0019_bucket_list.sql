-- Bucket List: want-to-go places live in the same `places` table, flagged
-- `bucket = true`. They render with a distinct pin, carry an optional website,
-- and never count toward visited stats until "Add to map" flips the flag off.
alter table places add column if not exists bucket boolean not null default false;
alter table places add column if not exists website text;

-- Fast lookup for the Bucket List page and to exclude wishlist places from
-- visited-only aggregates.
create index if not exists places_bucket_idx on places (bucket) where bucket;
