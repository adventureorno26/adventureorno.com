-- 0118 — Year-scoped mileage for Wrapped (Prompt 6, rec 36: "each selected year
-- uses that year's visits and mileage").
--
-- Wrapped summed mileage_by_person(null) across types = ALL-TIME mileage, shown for
-- whatever year was selected. This adds a member-gated RPC that returns the total
-- household miles for ONE year, de-duplicating shared outings (both members recording
-- the same activity counts once) the same way mileage_by_person does.
--
-- ROLLBACK: drop function if exists public.wrapped_year_miles(int);

create or replace function public.wrapped_year_miles(p_year int)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  with canon as (
    select distinct on (coalesce(shared_group_id, id)) distance
      from public.activities
     where start_date >= make_date(p_year, 1, 1)
       and start_date <  make_date(p_year + 1, 1, 1)
     order by coalesce(shared_group_id, id), id
  )
  select round((coalesce(sum(distance), 0::float8) / 1609.344::float8)::numeric, 1)
  from canon;
$function$;

revoke all on function public.wrapped_year_miles(int) from public, anon;
grant execute on function public.wrapped_year_miles(int) to authenticated;
