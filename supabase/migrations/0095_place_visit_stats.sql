-- 0095 — place_visit_stats(place): per-visit photo/video counts for the Place
-- card's visit timeline. Visits are date-islands; a photo/video belongs to a
-- visit when its capture date falls within [start_date, end_date] for the same
-- place. Member-gated and, per the 0093 discipline, callable only by authenticated.

create or replace function public.place_visit_stats(p_place uuid)
returns table (visit_id uuid, photos int, videos int)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id,
    (
      select count(*)::int
      from photos ph
      where ph.place_id = v.place_id
        and ph.deleted_at is null
        and ph.taken_at is not null
        and ph.taken_at::date between v.start_date and v.end_date
    ),
    (
      select count(*)::int
      from videos vd
      where vd.place_id = v.place_id
        and vd.taken_at is not null
        and vd.taken_at::date between v.start_date and v.end_date
    )
  from visits v
  where v.place_id = p_place
    and public.is_member();
$$;

revoke execute on function public.place_visit_stats(uuid) from anon, public;
grant execute on function public.place_visit_stats(uuid) to authenticated;
