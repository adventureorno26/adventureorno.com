-- Persistent Google Photos auth. Stores each person's Google refresh token so the
-- app can mint fresh access tokens forever without re-prompting sign-in. The
-- refresh token is a secret and is NEVER exposed to the browser: only the
-- google-photos-token edge function (service role) reads/writes this table, and it
-- hands the client only short-lived access tokens.

create table if not exists public.google_tokens (
  profile_id    uuid primary key references public.profiles (id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

-- RLS on, with NO client policies → the anon/authenticated roles cannot read or
-- write it at all. The edge function uses the service role (bypasses RLS).
alter table public.google_tokens enable row level security;
