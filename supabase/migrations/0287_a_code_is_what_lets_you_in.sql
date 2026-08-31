-- 0287 — an invite code is what turns a Google sign-in into an account.
--
-- Erica, 2026-08-30: *"invite code first. new user sees whatever level of privacy each
-- user as chosen. They can see public information."*
--
-- Two halves, and only the first one is this migration's business:
--
--   * THE DOOR is a code. Nobody becomes a member by asking and waiting. An existing
--     member hands out a code out of band — a text message, in person — and the code
--     is what creates the profile.
--   * WHAT YOU SEE once you are in is not narrowed on anyone's behalf. Each person's
--     own privacy choices govern that, and public information stays public. Nothing
--     here restricts reading; `0286` settled that visibility belongs to the space
--     boundary, never to the role.
--
-- WHY THIS REPLACES THE ASKING. Today a stranger signs in with Google, lands on
-- `join_requests`, and waits for the owner to notice. That flow keeps working (this
-- migration removes nothing), but it makes the owner a bottleneck on somebody else's
-- Tuesday, and it asks her to approve a name and an email she may not recognise. A code
-- moves the decision to the moment the member actually chose to invite somebody, which
-- is when they know who it is.
--
-- ---------------------------------------------------------------------------
-- SINGLE-USE, AND WHY.
-- ---------------------------------------------------------------------------
-- A code is redeemable exactly once. That is the default and there is no multi-use
-- variant, because:
--
--   * A code is a BEARER SECRET travelling over SMS and screenshots. Multi-use means
--     one forward turns one invited person into an unbounded number of accounts, and
--     nothing in the record says which of them the issuer meant.
--   * `redeemed_by` is only an answer when there is exactly one of it. "Who did this
--     code let in" is the question you ask after something goes wrong; a set is not an
--     answer you can act on.
--   * Revocation of a multi-use code is retroactively useless — the accounts it already
--     made are already made.
--   * The cost of the alternative is one extra RPC call by the issuer. Making four
--     codes is four button presses.
--
-- If a genuine reason for a multi-use code ever appears (an event, a group), it wants a
-- `max_redemptions int not null default 1` and a `redemptions` child table — NOT a
-- nullable `redeemed_by` doing double duty. Do not reach for it before then.
--
-- ---------------------------------------------------------------------------
-- FOUR REFUSALS, FOUR SENTENCES.
-- ---------------------------------------------------------------------------
-- "That code doesn't work" is useless, because the four ways a code can fail need four
-- different actions from the person holding it:
--
--   unknown    → they mistyped, or invented it     → check the code and type it again
--   expired    → time ran out                      → ask for a new one
--   revoked    → the issuer took it back           → talk to whoever gave it to you
--   redeemed   → somebody already used it          → this one is spent, ask for another
--
-- Each is a distinct `raise exception` whose MESSAGE is the sentence the person reads.
-- `app/src/lib/whyItFailed.ts` surfaces Postgres exception messages verbatim, so the
-- wording below is UI copy and should be edited as such.
--
-- ---------------------------------------------------------------------------
-- RESTORE SAFETY (the 0285 lesson).
-- ---------------------------------------------------------------------------
-- `scripts/restore-data.sh` runs under `session_replication_role = replica`, which
-- DISABLES TRIGGERS. `0285` was unrestorable backups caused by a NOT NULL column whose
-- value came from a trigger. So: THERE IS NO TRIGGER ON THIS TABLE. Every NOT NULL
-- column (`code`, `expires_at`, `role`, `created_at`) has a COLUMN DEFAULT, which the
-- INSERT itself evaluates and replica mode cannot switch off.
--
-- ---------------------------------------------------------------------------
-- WHO MAY EXECUTE WHAT — and the anon question, thought through.
-- ---------------------------------------------------------------------------
-- A new SECURITY DEFINER function default-grants EXECUTE to PUBLIC, so every function
-- below is revoked from `public, anon, authenticated` and then granted deliberately.
--
-- `redeem_invite_code` is the one that looks like it wants `anon`, and it must NOT have
-- it. Redemption's entire product is a `profiles` row keyed to `auth.uid()`. An `anon`
-- caller has no `auth.uid()`, so there is no row for it to make and nothing for it to
-- return — it could only burn the code on behalf of nobody. The correct order is
-- therefore: sign in with Google FIRST (which costs nothing and grants nothing), THEN
-- redeem as `authenticated`. Granting `anon` would add exactly one capability — letting
-- an unauthenticated stranger destroy a valid code by guessing it — which is a denial of
-- service dressed as convenience.
--
-- The four functions are `authenticated`-only, and three of them additionally require a
-- profile (`is_member()`). `redeem_invite_code` is the one that deliberately does not:
-- not having a profile is the whole reason you are calling it.

begin;

-- ---------------------------------------------------------------------------
-- 1. The alphabet, and reading a code back the way a person typed it.
-- ---------------------------------------------------------------------------
-- Crockford's base32: no I, L, O or U. I/L/O are dropped because they are unreadable
-- next to 1 and 0 on a phone screen; U is dropped because excluding it is what keeps a
-- random code from spelling something. Normalising maps the confusions people actually
-- make — I and L back to 1, O back to 0 — and throws away spaces, dashes and case, so
-- "cxk2-8gnh4m", "CXK2 8GNH4M" and "cxkz-8gnh4m" are one code.
create or replace function public.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(translate(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')),
                          'ILO', '110'), '');
$$;

comment on function public.normalize_invite_code(text) is
  'One code, however it was typed: strips separators and case, maps the I/1 and O/0 '
  'confusions onto Crockford base32. NULL for an empty string (0287).';

-- The generator. This is a COLUMN DEFAULT, deliberately (0285): a restore under
-- session_replication_role = replica supplies the stored code and never calls it, and no
-- trigger is involved either way. 10 characters of a 32-symbol alphabet is 2^50 codes;
-- the unique index below is what actually settles a collision.
create or replace function public.generate_invite_code()
returns text
language sql
volatile
set search_path = public
as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',
                           1 + floor(random() * 32)::int, 1), '')
    from generate_series(1, 10);
$$;

comment on function public.generate_invite_code() is
  'Ten Crockford base32 characters. Used as the DEFAULT for invite_codes.code so a '
  'restore with triggers disabled still satisfies NOT NULL (0287, per 0285).';

revoke execute on function public.normalize_invite_code(text) from public, anon;
revoke execute on function public.generate_invite_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.invite_codes (
  id           uuid        primary key default gen_random_uuid(),
  code         text        not null default public.generate_invite_code(),
  issued_by    uuid        not null references public.profiles (id) on delete cascade,
  note         text,
  role         text        not null default 'viewer',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  revoked_at   timestamptz,
  revoked_by   uuid        references public.profiles (id) on delete set null,
  redeemed_at  timestamptz,
  redeemed_by  uuid        references auth.users (id) on delete set null,
  constraint invite_codes_role_check
    check (role in ('editor', 'viewer')),
  constraint invite_codes_code_format
    check (code ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
  -- Redeemed is one fact with two columns; they move together or the row is a lie.
  constraint invite_codes_redemption_is_whole
    check ((redeemed_at is null) = (redeemed_by is null)),
  constraint invite_codes_revocation_is_whole
    check (revoked_at is not null or revoked_by is null)
);

-- Case is already gone by the time anything reaches here (everything writes and reads
-- through normalize_invite_code), so a plain unique index IS the uniqueness rule.
create unique index if not exists invite_codes_code_key on public.invite_codes (code);
create index if not exists invite_codes_issued_by_idx on public.invite_codes (issued_by, created_at desc);

comment on table public.invite_codes is
  'Single-use codes. Holding one is what turns a Google sign-in into a profile (0287). '
  'Never insert directly — create_invite_code/redeem_invite_code own every write.';
comment on column public.invite_codes.code is
  'The secret, normalised (Crockford base32, 10 chars). DEFAULT-generated so restores '
  'under replica mode satisfy NOT NULL without a trigger (0285).';
comment on column public.invite_codes.redeemed_by is
  'The auth.users row this code let in — exactly one, because the code is single-use. '
  'References auth.users rather than profiles so the record survives losing the profile.';
comment on column public.invite_codes.role is
  'The role the redeemer''s profile is created with. Roles govern WRITES only (0286); '
  'what a new person can SEE is each other person''s own privacy choice.';

alter table public.invite_codes enable row level security;

-- READ: the person who issued it, and the owner. Nobody else — the code is the secret,
-- so a policy that let members read each other's rows would hand out working codes.
-- There is deliberately NO insert/update/delete policy: every write goes through the
-- SECURITY DEFINER functions below, which is what makes redemption atomic.
drop policy if exists invite_codes_select_own on public.invite_codes;
create policy invite_codes_select_own on public.invite_codes
  for select to authenticated
  using (issued_by = auth.uid() or public.is_owner());

-- ---------------------------------------------------------------------------
-- 3. Issue.
-- ---------------------------------------------------------------------------
create or replace function public.create_invite_code(
  p_note            text default null,
  p_expires_in_days int  default 14,
  p_role            text default 'viewer'
)
returns public.invite_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  live int;
  made public.invite_codes;
begin
  if uid is null then
    raise exception 'Sign in before you make an invite code.';
  end if;
  if not public.is_member() then
    raise exception 'Only a member can invite somebody.';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'An invite can be for a viewer or an editor, not %.', p_role;
  end if;
  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 90 then
    raise exception 'An invite code lasts between 1 and 90 days.';
  end if;

  -- A cap, not a rate limit: an unbounded pile of live codes is an unbounded pile of
  -- working keys nobody is keeping track of. "At most", never "exactly" — this replays
  -- against an empty schema where the count is zero.
  select count(*) into live
    from public.invite_codes
   where issued_by = uid
     and redeemed_at is null and revoked_at is null and expires_at > now();
  if live >= 20 then
    raise exception 'You already have 20 unused invite codes. Revoke one before making another.';
  end if;

  insert into public.invite_codes (issued_by, note, role, expires_at)
  values (uid, nullif(btrim(coalesce(p_note, '')), ''), p_role,
          now() + make_interval(days => p_expires_in_days))
  returning * into made;

  return made;
end;
$$;

comment on function public.create_invite_code(text, int, text) is
  'Issue one single-use code, returning it in full — this is the only moment the issuer '
  'can read it out to give away (0287).';

-- ---------------------------------------------------------------------------
-- 4. List.
-- ---------------------------------------------------------------------------
-- `status` is computed rather than stored: expiry is a fact about the clock, and a
-- stored copy of it would need a job to stay true.
create or replace function public.list_my_invite_codes()
returns table (
  id             uuid,
  code           text,
  note           text,
  role           text,
  status         text,
  created_at     timestamptz,
  expires_at     timestamptz,
  redeemed_at    timestamptz,
  redeemed_name  text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.code,
         c.note,
         c.role,
         case
           when c.redeemed_at is not null then 'redeemed'
           when c.revoked_at  is not null then 'revoked'
           when c.expires_at <= now()     then 'expired'
           else 'live'
         end as status,
         c.created_at,
         c.expires_at,
         c.redeemed_at,
         p.display_name
    from public.invite_codes c
    left join public.profiles p on p.id = c.redeemed_by
   where c.issued_by = auth.uid()
   order by c.created_at desc;
$$;

comment on function public.list_my_invite_codes() is
  'The caller''s own codes with a computed status (live/expired/revoked/redeemed) and '
  'who each redeemed one let in (0287).';

-- ---------------------------------------------------------------------------
-- 5. Revoke.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_invite_code(p_id uuid)
returns public.invite_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c   public.invite_codes;
begin
  if uid is null then
    raise exception 'Sign in first.';
  end if;

  select * into c from public.invite_codes where id = p_id for update;
  if not found then
    raise exception 'That invite code no longer exists.';
  end if;
  if c.issued_by <> uid and not public.is_owner() then
    raise exception 'You can only revoke a code you issued.';
  end if;
  if c.redeemed_at is not null then
    raise exception 'That code has already been used, so revoking it would change nothing. '
                    'Remove the person instead.';
  end if;
  if c.revoked_at is not null then
    return c; -- already revoked: idempotent, not an error
  end if;

  update public.invite_codes
     set revoked_at = now(), revoked_by = uid
   where id = p_id
  returning * into c;

  return c;
end;
$$;

comment on function public.revoke_invite_code(uuid) is
  'Take back an unused code. Idempotent. Refuses a redeemed code, because revoking one '
  'would not un-make the account it created (0287).';

-- ---------------------------------------------------------------------------
-- 6. Redeem — the atomic one.
-- ---------------------------------------------------------------------------
-- THE RACE: two people hold the same single-use code and press the button together.
-- Both transactions must not get in.
--
-- `select ... for update` takes a row lock on the code. The second transaction BLOCKS
-- there until the first commits, and under READ COMMITTED it then re-reads the row it
-- was waiting on — seeing `redeemed_at` already set, and taking the "already used"
-- branch. The conditional `update ... where redeemed_at is null` behind it is not
-- decoration: it is what holds if the isolation level is ever raised, where the blocked
-- statement would instead abort with a serialization failure rather than see stale data.
--
-- The lock is taken BEFORE any validation, so there is no window between deciding the
-- code is usable and marking it used.
create or replace function public.redeem_invite_code(p_code text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  wanted    text := public.normalize_invite_code(p_code);
  existing  public.profiles;
  c         public.invite_codes;
  claimed   int;
begin
  -- `anon` cannot call this (see the header). If it somehow does, say so plainly.
  if uid is null then
    raise exception 'Sign in with Google first — a code makes an account for the '
                    'signed-in person, so we need to know who that is.';
  end if;

  -- Already a member: the code is not needed and must not be burned. This is the
  -- refresh-the-page-after-redeeming path, and it has to be a no-op.
  select * into existing from public.profiles where id = uid;
  if found then
    return existing;
  end if;

  if wanted is null then
    raise exception 'Enter your invite code.';
  end if;

  select * into c from public.invite_codes where code = wanted for update;

  if not found then
    raise exception 'That invite code isn''t one of ours. Check it and type it again — '
                    'letters and numbers only, and it doesn''t matter how you space them.';
  end if;
  if c.redeemed_at is not null then
    raise exception 'That invite code has already been used. Ask whoever gave it to you '
                    'for another one — each code lets in one person.';
  end if;
  if c.revoked_at is not null then
    raise exception 'That invite code was taken back by the person who gave it to you. '
                    'Ask them about it.';
  end if;
  if c.expires_at <= now() then
    raise exception 'That invite code expired on %. Ask whoever gave it to you for a new one.',
      to_char(c.expires_at, 'FMDD Mon YYYY');
  end if;

  update public.invite_codes
     set redeemed_at = now(), redeemed_by = uid
   where id = c.id and redeemed_at is null;
  get diagnostics claimed = row_count;
  if claimed <> 1 then
    -- Only reachable above READ COMMITTED, and only as a loser of the race.
    raise exception 'That invite code has already been used. Ask whoever gave it to you '
                    'for another one — each code lets in one person.';
  end if;

  insert into public.profiles (id, role, display_name)
  values (uid, c.role,
          nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name',
                                auth.jwt() -> 'user_metadata' ->> 'name',
                                split_part(coalesce(auth.jwt() ->> 'email', 'friend'), '@', 1))), ''))
  returning * into existing;

  return existing;
end;
$$;

comment on function public.redeem_invite_code(text) is
  'The door. Turns a signed-in Google session with a valid code into a profile, exactly '
  'once per code — `for update` serialises two people racing the same code (0287).';

-- ---------------------------------------------------------------------------
-- 7. Grants. A new SECDEF function is EXECUTE-to-PUBLIC until told otherwise.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_invite_code(text, int, text) from public, anon, authenticated;
revoke execute on function public.list_my_invite_codes()             from public, anon, authenticated;
revoke execute on function public.revoke_invite_code(uuid)           from public, anon, authenticated;
revoke execute on function public.redeem_invite_code(text)           from public, anon, authenticated;

grant execute on function public.create_invite_code(text, int, text) to authenticated;
grant execute on function public.list_my_invite_codes()              to authenticated;
grant execute on function public.revoke_invite_code(uuid)            to authenticated;
-- `authenticated` and NOT `anon`: you must be signed in for there to be an account to
-- make. See the header for why granting anon would only buy a way to burn codes.
grant execute on function public.redeem_invite_code(text)            to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Prove it, here, at apply time.
-- ---------------------------------------------------------------------------
-- Every assertion below is a RELATION or an "at most", never "exactly N" — this replays
-- from an EMPTY schema in scripts/db-test.sh, where production counts are 0.
do $$
declare
  d text;
  n int;
begin
  -- (a) The 0285 rule. Every NOT NULL column whose value is DERIVED rather than
  --     supplied has a DEFAULT, so an insert under session_replication_role = replica
  --     (triggers off) still satisfies NOT NULL. `issued_by` is deliberately not in
  --     this list: it is data the caller provides and a restore replays, not something
  --     anything derives — a default for it would be an invented fact.
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'invite_codes'
     and column_name in ('id','code','role','created_at','expires_at')
     and is_nullable = 'NO' and column_default is null;
  if n <> 0 then
    raise exception '% derived NOT NULL column(s) on invite_codes have no default — a restore will fail', n;
  end if;

  -- (b) And no trigger to depend on, which is how (a) stays true.
  select count(*) into n from pg_trigger
   where tgrelid = 'public.invite_codes'::regclass and not tgisinternal;
  if n <> 0 then
    raise exception 'invite_codes grew % trigger(s); replica mode disables them (0285)', n;
  end if;

  -- (c) Nothing anonymous may execute any of this.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('create_invite_code','list_my_invite_codes','revoke_invite_code',
                       'redeem_invite_code','generate_invite_code')
     and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then
    raise exception '% invite-code function(s) are anon-executable', n;
  end if;

  -- (d) Reading a code is not something a policy hands to members at large.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'invite_codes'
     and cmd in ('ALL','SELECT') and policyname <> 'invite_codes_select_own';
  if n <> 0 then
    raise exception '% extra policy/policies can grant a SELECT on invite_codes', n;
  end if;

  -- (e) Normalisation is the same code however it was typed: separators, case, and the
  --     three confusions (I→1, l→1, O→0) all collapse onto one string.
  if public.normalize_invite_code('cxk1-8gnh4m') is distinct from 'CXK18GNH4M'
     or public.normalize_invite_code('CXK1 8GNH4M') is distinct from 'CXK18GNH4M'
     or public.normalize_invite_code('cxkI-8gnhlm') is distinct from 'CXK18GNH1M'
     or public.normalize_invite_code('OO') is distinct from '00'
     or public.normalize_invite_code('  ') is not null then
    raise exception 'normalize_invite_code does not agree with itself';
  end if;

  -- (f) The generator produces something the format constraint accepts.
  select public.generate_invite_code() into d;
  if d !~ '^[0-9A-HJKMNP-TV-Z]{10}$' then
    raise exception 'generate_invite_code produced %, which invite_codes_code_format rejects', d;
  end if;
end $$;

commit;
