-- 0115 — Random, expiring, single-use, session-bound OAuth state (Prompt 3).
--
-- Strava linking previously used the owner's raw profile id as the OAuth `state`.
-- That's guessable and replayable: anyone who knows the owner's uuid could craft a
-- link flow that attaches THEIR Strava account to the owner's profile (OAuth CSRF /
-- account injection). This adds a proper state store.
--
-- (Strava's OAuth server does not support PKCE / code_challenge, so PKCE is N/A here;
-- the state hardening is the applicable protection.)
--
-- ROLLBACK:
--   drop function if exists public.consume_oauth_state(text, text);
--   drop function if exists public.strava_oauth_start();
--   drop table if exists public.oauth_states;

create table if not exists public.oauth_states (
  state      text primary key,
  provider   text not null default 'strava',
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists oauth_states_expiry_idx on public.oauth_states(expires_at);

-- Only SECURITY DEFINER functions touch this table. RLS on + no policy = deny all
-- direct client/anon access.
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

-- Mint a random single-use state (10-min TTL) bound to the CALLER's profile. Only an
-- owner/editor may start a Strava link, so the bound profile is a real editing account.
create or replace function public.strava_oauth_start()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_state text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.is_editor_or_owner() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Opportunistically reap expired/used states so the table stays small.
  delete from public.oauth_states where expires_at < now() - interval '1 day';
  insert into public.oauth_states (state, provider, profile_id, expires_at)
  values (v_state, 'strava', auth.uid(), now() + interval '10 minutes');
  return v_state;
end
$function$;
revoke all on function public.strava_oauth_start() from public, anon;
grant execute on function public.strava_oauth_start() to authenticated;

-- Validate + single-use-consume a state, returning the bound profile_id (or NULL if
-- missing/expired/already used). Called ONLY by the callback edge function via the
-- service role — never a client.
create or replace function public.consume_oauth_state(p_state text, p_provider text default 'strava')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_profile uuid;
begin
  update public.oauth_states
     set used_at = now()
   where state = p_state and provider = p_provider
     and used_at is null and expires_at > now()
  returning profile_id into v_profile;
  return v_profile;
end
$function$;
revoke all on function public.consume_oauth_state(text, text) from public, anon, authenticated;
