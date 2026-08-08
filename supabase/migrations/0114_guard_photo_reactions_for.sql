-- 0114 — Add the membership guard to photo_reactions_for (Prompt 3).
--
-- Almost every SECURITY DEFINER read RPC already starts with
-- `select public.assert_member();` (raises 'members only' for a logged-in
-- non-member). photo_reactions_for was the lone exception: it reads the reactions
-- (and reactor display names) for any photo id with no membership check, so a
-- logged-in non-member could enumerate them. Add the same guard; the query is
-- otherwise byte-identical.
--
-- Deliberately NOT guarded: place_is_saved (a helper invoked *inside* RLS policies —
-- guarding it would break policy evaluation) and strava_connected_me (self-scoped
-- via auth.uid(), returns only the caller's own boolean).
--
-- ROLLBACK: recreate photo_reactions_for without the leading assert_member() call.

create or replace function public.photo_reactions_for(p_photo uuid)
returns table(emoji text, n integer, who text[], mine boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.assert_member();

  select r.emoji, count(*)::int as n,
    array_agg(coalesce(p.display_name, 'Someone') order by p.display_name) as who,
    bool_or(r.profile_id = auth.uid()) as mine
  from public.photo_reactions r
  join public.profiles p on p.id = r.profile_id
  where r.photo_id = p_photo
  group by r.emoji
  order by n desc, r.emoji;
$function$;
