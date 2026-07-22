-- 0056_place_category_sync.sql — keep the singular `category` + container flags in
-- sync with is_trail / categories[] on every insert/update, so any path that
-- creates a place (detect-trips, manual "Group as trip", the UI) gets correct
-- counts_as_place without each caller remembering to set it. Without this, an
-- auto-detected trip (categories=['trip'], category=null) would count as a place.

create or replace function public.sync_place_category() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Derive the singular category, most-specific first. Preserve an explicitly-set
  -- category for leaves (activities set category directly); only fill/normalize.
  NEW.category := case
    when NEW.is_trail then 'trail'
    when NEW.categories @> array['trip'] then 'trip'
    when NEW.category is not null then NEW.category
    when coalesce(array_length(NEW.categories,1),0) > 0 then NEW.categories[1]
    when coalesce(array_length(NEW.activity_categories,1),0) > 0 then NEW.activity_categories[1]
    else null end;
  NEW.holds_children := coalesce(NEW.category in ('trail','trip'), false);
  NEW.kind := case when NEW.holds_children then 'container' else 'leaf' end;
  return NEW;
end $$;

drop trigger if exists places_sync_category on public.places;
create trigger places_sync_category
  before insert or update of categories, activity_categories, is_trail, category on public.places
  for each row execute function public.sync_place_category();

-- Reconcile any existing rows once (no-op where already correct).
update public.places set category = category;
