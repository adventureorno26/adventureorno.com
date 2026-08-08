-- 0135 — React to an activity, the same way you react to a photo.
--
-- Erica picked two reactions (Love it, Crushed it) and asked for them "for photos
-- and also on activity card maps". Photos already have `photo_reactions`; activities
-- had nothing. This mirrors the photo tables and functions exactly — same shape, same
-- guards, same grants — so there is one pattern rather than two.
--
-- The stored value stays an emoji string, matching photo_reactions. The two marks are
-- drawn in the app, but the DATA is portable and the existing photo reactions keep
-- working untouched. No migration of existing reactions is needed.

create table if not exists public.activity_reactions (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id)   on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (activity_id, profile_id, emoji)
);

create index if not exists activity_reactions_activity_idx
  on public.activity_reactions (activity_id);

alter table public.activity_reactions enable row level security;

-- Members read; you write only your own row. Same rule as photo_reactions.
drop policy if exists activity_reactions_read on public.activity_reactions;
create policy activity_reactions_read on public.activity_reactions
  for select using (public.is_member());

drop policy if exists activity_reactions_write on public.activity_reactions;
create policy activity_reactions_write on public.activity_reactions
  for all using (public.is_member() and profile_id = auth.uid())
  with check (public.is_member() and profile_id = auth.uid());

create or replace function public.activity_reactions_for(p_activity uuid)
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
  from public.activity_reactions r
  join public.profiles p on p.id = r.profile_id
  where r.activity_id = p_activity
  group by r.emoji
  order by n desc, r.emoji;
$function$;

create or replace function public.toggle_activity_reaction(p_activity uuid, p_emoji text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_member() then raise exception 'not authorized'; end if;
  if exists (select 1 from public.activity_reactions
             where activity_id = p_activity and profile_id = v_me and emoji = p_emoji) then
    delete from public.activity_reactions
      where activity_id = p_activity and profile_id = v_me and emoji = p_emoji;
  else
    insert into public.activity_reactions (activity_id, profile_id, emoji)
    values (p_activity, v_me, p_emoji)
    on conflict do nothing;
  end if;
end $function$;

revoke all on function public.activity_reactions_for(uuid) from public;
revoke all on function public.activity_reactions_for(uuid) from anon;
grant execute on function public.activity_reactions_for(uuid) to authenticated;
grant execute on function public.activity_reactions_for(uuid) to service_role;

revoke all on function public.toggle_activity_reaction(uuid, text) from public;
revoke all on function public.toggle_activity_reaction(uuid, text) from anon;
grant execute on function public.toggle_activity_reaction(uuid, text) to authenticated;
grant execute on function public.toggle_activity_reaction(uuid, text) to service_role;
