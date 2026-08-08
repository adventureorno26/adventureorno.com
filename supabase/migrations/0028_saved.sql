-- Places must be explicitly saved to appear on the map / count in stats. New
-- places start unsaved (so an accidental map click or search doesn't create a
-- permanent pin); the card's Save button flips this on. All existing places are
-- backfilled as saved.
alter table places add column if not exists saved boolean not null default false;
update places set saved = true;
