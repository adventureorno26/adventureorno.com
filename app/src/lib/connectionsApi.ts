// Reaching the database for people, profiles and connections — 0283 and 0284, one module.
//
// The RULES live next door in `connections.ts`, which has no database in it and is unit
// tested. This file is only the round trips.
//
// EVERY WRITE IS AN RPC. The three connection tables carry SELECT and nothing else (0284),
// so there is no `.insert()` to reach for; and every RPC derives the caller from
// `auth.uid()` rather than an argument, so nothing here passes "who I am".
//
// TWO THINGS THE DATABASE DOES NOT DO FOR US YET, said out loud because a reader will
// otherwise assume it does:
//
//  1. `find_profiles()` (0283, written before blocking existed) does NOT filter blocked
//     accounts, and `public_profile()` still carries its own `TODO (item 2, blocking)`.
//     Both are SECURITY DEFINER, so RLS cannot save them. What DOES consider a block is the
//     `profiles` table itself — `profiles_select` is
//     `id = auth.uid() or (is_member() and not is_blocked_between(id, auth.uid()))` (0284,
//     0286) — so every handle here is resolved through that table, and a handle that does
//     not resolve is dropped. A blocked person therefore disappears from search and from
//     their profile route, in the one direction a client is able to enforce it.
//     The block holds in the other direction where it matters most: `block_profile()` has
//     already deleted the add and both follows, and every connection RPC refuses across a
//     block with the same message it gives for an account that does not exist.
//  2. Resolving a handle through `profiles` needs `is_member()`, which is global today. A
//     signed-in non-member would find nobody. That is the space partition (item 9), not
//     this file.
import { supabase } from './supabase';
import { rpcFor, type ActionKey, type ConnectionRow } from './connections';

/** What `find_profiles()` publishes, plus the id the action RPCs need. */
export interface FoundPerson {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchMyConnections(): Promise<ConnectionRow[]> {
  const { data, error } = await supabase.rpc('my_connections');
  if (error) throw error;
  return (data ?? []) as ConnectionRow[];
}

/**
 * Search, then resolve each handle to the id the action RPCs need.
 *
 * The second query is not decoration: `find_profiles()` returns "only what those people
 * published — no id" (0283), and it does not know about blocks. `profiles` supplies both.
 */
export async function searchPeople(query: string, limit = 20): Promise<FoundPerson[]> {
  const term = query.trim();
  // The database asks for two characters and would return nothing; save the round trip and
  // let the screen say why.
  if (term.length < 2) return [];

  const { data, error } = await supabase.rpc('find_profiles', { p_query: term, p_limit: limit });
  if (error) throw error;
  const found = (data ?? []) as Omit<FoundPerson, 'id'>[];
  if (found.length === 0) return [];

  const ids = await idsForHandles(found.map((f) => f.handle));
  // A handle that did not resolve is one `profiles` would not show us — a block, in the
  // one direction a client can see. It is dropped rather than rendered without actions.
  return found.map((f) => ({ ...f, id: ids.get(f.handle) ?? '' })).filter((f) => f.id !== '');
}

/** Handle → profile id, through the one table that considers blocks. */
export async function idsForHandles(handles: string[]): Promise<Map<string, string>> {
  const wanted = handles.filter(Boolean);
  if (wanted.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, handle')
    .in('handle', wanted);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; handle: string | null }[]) {
    if (row.handle) map.set(row.handle, row.id);
  }
  return map;
}

export async function idForHandle(handle: string): Promise<string | null> {
  const map = await idsForHandles([handle.trim().toLowerCase()]);
  return map.get(handle.trim().toLowerCase()) ?? null;
}

export interface PublicProfileCard {
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  member_since: string | null;
  shows: { stats: boolean; places: boolean; activity: boolean };
  /** THEIR OWN totals — all of theirs, per §0.2. Null when they did not publish them. */
  stats: { places: number; miles: number; trips: number } | null;
  places: { name: string; lat: number; lng: number; categories: string[]; visits: number }[] | null;
  activity:
    | {
        kind: 'outing' | 'visit';
        happened_on: string | null;
        title: string | null;
        type: string | null;
        place_name: string | null;
        distance: number | null;
      }[]
    | null;
}

/**
 * One person's public card, or null.
 *
 * Null means "no such handle" AND "that account is private" AND — because this client adds
 * the check the function still carries a TODO for — "there is a block between you". One
 * answer for all three, which is what 0283 designed the first two to be.
 */
export async function fetchPublicProfile(
  handle: string,
): Promise<{ card: PublicProfileCard; id: string | null } | null> {
  const clean = handle.trim().toLowerCase();
  if (!clean) return null;
  const [{ data, error }, id] = await Promise.all([
    supabase.rpc('public_profile', { p_handle: clean }),
    idForHandle(clean).catch(() => null),
  ]);
  if (error) throw error;
  if (!data) return null;
  // `profiles_select` shows you your OWN row whatever else is true, and everybody else's
  // only when there is no block. So a handle the card knows and that table will not resolve
  // is a blocked account: the same nothing as a handle that does not exist.
  if (!id) return null;
  return { card: data as unknown as PublicProfileCard, id };
}

// ---------------------------------------------------------------------------
// Writes — one RPC each, and the caller is always auth.uid()
// ---------------------------------------------------------------------------

/** Do it. One RPC, named by the rule next door, and the caller is always auth.uid(). */
export async function runConnectionAction(key: ActionKey, profileId: string): Promise<void> {
  const { error } = await supabase.rpc(rpcFor(key), { p_profile: profileId });
  if (error) throw error;
}
