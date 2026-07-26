-- "Keep separate" for the Duplicate-places suggester: remember pairs the user has
-- decided are NOT duplicates, so they never resurface. Stored order-independent
-- (least/greatest) so (A,B) and (B,A) are the same dismissal.

create table if not exists public.dup_dismissed (
  place_a    uuid not null references public.places (id) on delete cascade,
  place_b    uuid not null references public.places (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (place_a, place_b)
);
alter table public.dup_dismissed enable row level security;
drop policy if exists dup_dismissed_select on public.dup_dismissed;
create policy dup_dismissed_select on public.dup_dismissed for select using (public.is_member());
drop policy if exists dup_dismissed_write on public.dup_dismissed;
create policy dup_dismissed_write on public.dup_dismissed for all
  using (public.is_editor_or_owner()) with check (public.is_editor_or_owner());

create or replace function public.dismiss_duplicate(p_a uuid, p_b uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.dup_dismissed (place_a, place_b, created_by)
  values (least(p_a, p_b), greatest(p_a, p_b), auth.uid())
  on conflict do nothing;
$$;
grant execute on function public.dismiss_duplicate(uuid, uuid) to authenticated;
