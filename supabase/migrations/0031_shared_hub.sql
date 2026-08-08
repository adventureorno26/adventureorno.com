create table if not exists shared_links (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  url text not null,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table shared_links enable row level security;
drop policy if exists shared_links_select on shared_links;
drop policy if exists shared_links_write on shared_links;
create policy shared_links_select on shared_links for select using (is_member());
create policy shared_links_write on shared_links for all using (is_editor_or_owner()) with check (is_editor_or_owner());

create table if not exists board_items (
  id uuid primary key default gen_random_uuid(),
  board text not null,
  title text not null,
  url text,
  note text,
  done boolean not null default false,
  done_at timestamptz,
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table board_items enable row level security;
drop policy if exists board_items_select on board_items;
drop policy if exists board_items_write on board_items;
create policy board_items_select on board_items for select using (is_member());
create policy board_items_write on board_items for all using (is_editor_or_owner()) with check (is_editor_or_owner());
