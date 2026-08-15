-- 0187 — §0.8 phase 8, step 3d: who was on every visit, in one request.
--
-- The bulk editor loads EVERY visit at once and shows a who-control per row, so it is
-- the last screen reading `visits.solo_profile`. 0186's `place_visit_people` answers for
-- one place, which would be a request per place here.
--
-- ~590 participant rows across 489 visits: small enough to hand over whole, and it
-- replaces a column that cannot describe three people with rows that can.
--
-- ROLLBACK: drop function public.visit_people_all().

begin;

create or replace function public.visit_people_all()
returns table(visit_id uuid, profile_id uuid, display_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select vp.visit_id, vp.profile_id, pr.display_name
    from public.visit_profiles vp
    join public.profiles pr on pr.id = vp.profile_id
   order by vp.visit_id, pr.display_name;
$function$;

comment on function public.visit_people_all() is
  'Who was on every visit, as rows. For the bulk editor, which loads all visits at '
  'once — per-place would be a request per place (§0.3).';

revoke all on function public.visit_people_all() from public, anon;
grant execute on function public.visit_people_all() to authenticated;

commit;
