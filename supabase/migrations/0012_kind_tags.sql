-- 0012_kind_tags.sql — entry "Kind" becomes a category tag; auto-tags the place.

-- Kind is now any category slug (or 'note'); drop the old 4-value constraint.
alter table public.entries drop constraint if exists entries_kind_check;

-- Migrate legacy kinds to category slugs.
update public.entries set kind = 'dining' where kind = 'restaurant';

-- Trigger: adding/updating a spot whose kind is a category slug tags the place.
create or replace function public.tag_place_from_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare cats text[] := array['hiking','walking','running','biking','jeeping','camping','beach',
                             'sunrise','sunset','dining','winery','brewery','viewpoint','stay'];
begin
  if NEW.place_id is not null and NEW.kind = any(cats) then
    update public.places
       set categories = array(select distinct unnest(categories || array[NEW.kind]))
     where id = NEW.place_id and not (NEW.kind = any(categories));
  end if;
  return NEW;
end $$;

drop trigger if exists entries_tag_place on public.entries;
create trigger entries_tag_place after insert or update of kind, place_id on public.entries
  for each row execute function public.tag_place_from_entry();

-- Backfill: tag places from their existing categorized entries.
do $$ declare r record; begin
  for r in select distinct place_id, kind from public.entries
           where place_id is not null and kind in ('hiking','walking','running','biking','jeeping',
             'camping','beach','sunrise','sunset','dining','winery','brewery','viewpoint','stay') loop
    update public.places set categories = array(select distinct unnest(categories || array[r.kind]))
      where id = r.place_id;
  end loop;
end $$;
