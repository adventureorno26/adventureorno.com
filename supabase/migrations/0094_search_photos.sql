-- 0094 — search_photos(jsonb): structured photo search over the whole library.
--
-- Backs the natural-language photo search. An edge function (nl-search) turns a
-- phrase like "sunsets from beach trips in 2024" into this filter object using
-- Claude; the actual data access happens HERE, inside RLS-respecting SQL, so the
-- LLM never touches rows. Every filter key is optional; omitted keys don't
-- constrain. All predicates are null-safe (a missing key → no filter).
--
-- Filter shape (all optional):
--   categories text[]  — match place.category OR place.categories OR activity_categories
--   cities     text[]  — place.city   (case-insensitive exact)
--   states     text[]  — place.admin1 (case-insensitive exact)
--   countries  text[]  — place.country
--   parks      text[]  — place.park
--   year       int     — year of photo.taken_at
--   date_from  date    — photo.taken_at >= date_from
--   date_to    date    — photo.taken_at <= date_to
--   min_rating int     — place.rating >= min_rating
--   text       text    — substring match in place.name / place.review / photo.caption
--
-- Member-gated (is_member) and, like every function since 0093, callable only by
-- `authenticated` — never anon.

create or replace function public.search_photos(p_filter jsonb)
returns table (
  photo_id uuid,
  place_id uuid,
  place_name text,
  city text,
  category text,
  taken_at timestamptz,
  caption text
)
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select
      case when p_filter ? 'categories'
           then array(select jsonb_array_elements_text(p_filter->'categories')) end as cats,
      case when p_filter ? 'cities'
           then array(select lower(jsonb_array_elements_text(p_filter->'cities'))) end as cities,
      case when p_filter ? 'states'
           then array(select lower(jsonb_array_elements_text(p_filter->'states'))) end as states,
      case when p_filter ? 'countries'
           then array(select lower(jsonb_array_elements_text(p_filter->'countries'))) end as countries,
      case when p_filter ? 'parks'
           then array(select lower(jsonb_array_elements_text(p_filter->'parks'))) end as parks,
      nullif(p_filter->>'year','')::int          as yr,
      nullif(p_filter->>'date_from','')::date    as date_from,
      nullif(p_filter->>'date_to','')::date      as date_to,
      nullif(p_filter->>'min_rating','')::int    as min_rating,
      nullif(p_filter->>'text','')               as txt
  )
  select ph.id, pl.id, pl.name, pl.city, pl.category, ph.taken_at, ph.caption
  from photos ph
  join places pl on pl.id = ph.place_id
  cross join f
  where public.is_member()
    and ph.deleted_at is null
    and pl.deleted_at is null
    and (f.cats is null
         or pl.category = any(f.cats)
         or pl.categories && f.cats
         or pl.activity_categories && f.cats)
    and (f.cities    is null or lower(pl.city)    = any(f.cities))
    and (f.states    is null or lower(pl.admin1)  = any(f.states))
    and (f.countries is null or lower(pl.country) = any(f.countries))
    and (f.parks     is null or lower(pl.park)    = any(f.parks))
    and (f.yr is null         or extract(year from ph.taken_at)::int = f.yr)
    and (f.date_from is null  or ph.taken_at >= f.date_from)
    and (f.date_to is null    or ph.taken_at < (f.date_to + 1))
    and (f.min_rating is null or coalesce(pl.rating,0) >= f.min_rating)
    and (f.txt is null
         or pl.name    ilike '%'||f.txt||'%'
         or pl.review  ilike '%'||f.txt||'%'
         or ph.caption ilike '%'||f.txt||'%')
  order by ph.taken_at desc nulls last
  limit 300;
$$;

revoke execute on function public.search_photos(jsonb) from anon, public;
grant execute on function public.search_photos(jsonb) to authenticated;
