-- 0074_photo_captions_reactions.sql — captions + emoji reactions on photos (a
-- couples app: you and Josh react to each other's photos). caption is a plain
-- text column; reactions are (photo, person, emoji) rows so each of you can add
-- and remove your own, and we can show who reacted with what.

alter table public.photos add column if not exists caption text;

create table if not exists public.photo_reactions (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (photo_id, profile_id, emoji)
);
create index if not exists photo_reactions_photo on public.photo_reactions(photo_id);

alter table public.photo_reactions enable row level security;

drop policy if exists photo_reactions_select on public.photo_reactions;
create policy photo_reactions_select on public.photo_reactions
  for select using (public.is_member());

-- Each person manages only their OWN reactions.
drop policy if exists photo_reactions_write on public.photo_reactions;
create policy photo_reactions_write on public.photo_reactions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Set/clear a photo caption (owner or editor).
create or replace function public.set_photo_caption(p_photo uuid, p_caption text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor_or_owner() then raise exception 'not authorized'; end if;
  update public.photos set caption = nullif(btrim(p_caption), '') where id = p_photo;
end $$;
grant execute on function public.set_photo_caption(uuid, text) to authenticated;

-- Toggle the caller's emoji reaction on a photo (add if absent, remove if present).
create or replace function public.toggle_photo_reaction(p_photo uuid, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not public.is_member() then raise exception 'not authorized'; end if;
  if exists (select 1 from public.photo_reactions
             where photo_id = p_photo and profile_id = v_me and emoji = p_emoji) then
    delete from public.photo_reactions
      where photo_id = p_photo and profile_id = v_me and emoji = p_emoji;
  else
    insert into public.photo_reactions (photo_id, profile_id, emoji) values (p_photo, v_me, p_emoji)
      on conflict do nothing;
  end if;
end $$;
grant execute on function public.toggle_photo_reaction(uuid, text) to authenticated;

-- Reactions for a photo, grouped: emoji + count + who (display names).
create or replace function public.photo_reactions_for(p_photo uuid)
returns table(emoji text, n integer, who text[], mine boolean)
language sql stable security definer set search_path = public as $$
  select r.emoji, count(*)::int as n,
    array_agg(coalesce(p.display_name, 'Someone') order by p.display_name) as who,
    bool_or(r.profile_id = auth.uid()) as mine
  from public.photo_reactions r
  join public.profiles p on p.id = r.profile_id
  where r.photo_id = p_photo
  group by r.emoji
  order by n desc, r.emoji;
$$;
grant execute on function public.photo_reactions_for(uuid) to authenticated;
