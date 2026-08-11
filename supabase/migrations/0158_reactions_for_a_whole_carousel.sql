-- 0158 — read the reactions for a WHOLE carousel in one call.
--
-- Erica, 2026-08-11: "On the main card it should be one carousel with the date and
-- ability for others to like with a heart or the fire." The marks used to live only
-- inside the full-screen lightbox, so they were invisible until you opened a photo —
-- which is why she read them as missing.
--
-- Putting them on the strip means asking about every visible photo at once.
-- photo_reactions_for(uuid) answers ONE photo, so a San Diego card would have fired
-- ~40 round trips on open. This is that function with an array argument and the
-- photo id carried through, so the strip costs exactly one request.
--
-- Same membership guard, same shape, same grouping — only the WHERE changes.
--
-- ROLLBACK: drop function public.photo_reactions_for_many(uuid[]);
--           (photo_reactions_for is untouched and still serves the lightbox.)

create or replace function public.photo_reactions_for_many(p_photos uuid[])
returns table(photo_id uuid, emoji text, n integer, who text[], mine boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select r.photo_id, r.emoji, count(*)::int as n,
    array_agg(coalesce(p.display_name, 'Someone') order by p.display_name) as who,
    bool_or(r.profile_id = auth.uid()) as mine
  from public.photo_reactions r
  join public.profiles p on p.id = r.profile_id
  where r.photo_id = any(p_photos)
  group by r.photo_id, r.emoji
  order by r.photo_id, r.emoji;
$function$;

revoke all on function public.photo_reactions_for_many(uuid[]) from public;
grant execute on function public.photo_reactions_for_many(uuid[]) to authenticated;
