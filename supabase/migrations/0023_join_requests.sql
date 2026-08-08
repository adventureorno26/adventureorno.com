-- Join-request sign-in: a signed-in Google user with no profile can ask to join.
-- The owner approves them as a viewer or contributor (editor) from Settings.
create table if not exists join_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  display_name text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table join_requests enable row level security;

-- A user may create/see their own request; the owner sees them all.
create policy jr_insert_own on join_requests for insert to authenticated
  with check (user_id = auth.uid());
create policy jr_select_visible on join_requests for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'owner')
  );
-- A user can refresh (upsert) their own pending request.
create policy jr_update_own on join_requests for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Owner approves → creates/updates the profile with the chosen role.
create or replace function public.approve_join_request(p_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid; nm text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'owner') then
    raise exception 'not authorized';
  end if;
  if p_role not in ('viewer', 'editor') then
    raise exception 'invalid role';
  end if;
  select user_id, display_name into uid, nm from join_requests where id = p_id;
  if uid is null then raise exception 'request not found'; end if;
  insert into profiles (id, role, display_name) values (uid, p_role, nm)
    on conflict (id) do update set role = excluded.role;
  update join_requests set status = 'approved' where id = p_id;
end $$;

create or replace function public.deny_join_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'owner') then
    raise exception 'not authorized';
  end if;
  update join_requests set status = 'denied' where id = p_id;
end $$;

grant execute on function public.approve_join_request(uuid, text) to authenticated;
grant execute on function public.deny_join_request(uuid) to authenticated;
