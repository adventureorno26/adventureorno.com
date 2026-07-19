-- 0011_entry_tags.sql — adding a restaurant/stay entry auto-tags the place.
create or replace function public.tag_place_from_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare cat text;
begin
  cat := case NEW.kind
           when 'restaurant' then 'dining'
           when 'stay' then 'stay'
           else null end;
  if cat is not null and NEW.place_id is not null then
    update public.places
       set categories = array(select distinct unnest(categories || array[cat]))
     where id = NEW.place_id and not (cat = any(categories));
  end if;
  return NEW;
end $$;

drop trigger if exists entries_tag_place on public.entries;
create trigger entries_tag_place after insert or update of kind, place_id on public.entries
  for each row execute function public.tag_place_from_entry();

-- Backfill existing restaurant/stay entries.
do $$ declare r record; begin
  for r in select distinct place_id, kind from public.entries where kind in ('restaurant','stay') and place_id is not null loop
    update public.places set categories = array(select distinct unnest(categories || array[case r.kind when 'restaurant' then 'dining' else 'stay' end]))
      where id = r.place_id;
  end loop;
end $$;
