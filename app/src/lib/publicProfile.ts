// YOUR OWN PUBLIC PROFILE — the half of §CONNECTING TO SOMEONE that was never built.
//
// WHAT WAS MISSING, measured on production 2026-08-30. `/people` and `/profile/:handle`
// shipped and work, and both are empty for everybody, because `0283` defaults
// `profile_visibility` to `private` and `public_stats` / `public_places` /
// `public_activity` to `false`, and NOTHING IN THE APP COULD CHANGE ANY OF THEM — no
// handle field, no bio, no switches, nowhere. `find_profiles()` only ever matches
// `profile_visibility = 'public'`, so the directory could not find a single person, and
// the reason was not a bug in the search: nobody could publish themselves.
//
// NO MIGRATION IS NEEDED AND NONE IS ADDED. Both doors already exist and are applied:
//
//   set_handle(text)            claim your handle. Works ONCE — 0283's guard holds a
//                               claimed handle still afterwards, because a link to a
//                               person must keep meaning that person.
//   save_public_profile(…)      the one door for the rest of the card. Every argument is
//                               optional, NULL means "leave it alone", an empty string
//                               clears a text field. One call so a client cannot half-save
//                               it, and nothing there can touch `role`.
//
// WHY THE WRITES ARE RPCs AND NOT AN UPDATE. `profiles` is owner-only for INSERT/UPDATE/
// DELETE (0286: `profiles_owner_update … using (public.is_owner())`), so an editor writing
// to their own row directly is refused. Both functions are SECURITY DEFINER and act on
// `auth.uid()`, which is what lets a member edit THEIR OWN card and nobody else's.
//
// PRIVACY IS THE USER'S OWN CHOICE. Erica, 2026-08-30: *"it's fine for users to share their
// home address and whatever else they want to share."* So nothing here hides a category on
// anyone's behalf; the default is private and every switch is theirs.
import { supabase } from './supabase';

/** The handle rule, mirroring 0283's `profiles_handle_format` CHECK exactly:
 *  `^[a-z0-9][a-z0-9_]{1,29}$` — 2–30 chars, lowercase, starts alphanumeric. Kept here
 *  so the field can say what is wrong BEFORE a round trip, and pinned by a test against
 *  the same string, because a client rule that drifts from the constraint is worse than
 *  no client rule: it refuses handles the database would have accepted. */
export const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,29}$/;

/** 0283's `profiles_bio_length` CHECK. */
export const BIO_MAX = 280;

/** Handles the database refuses outright, because each is (or will be) a path segment in
 *  the web app and a handle becomes a path segment.
 *
 *  THIS IS A COPY, AND A COPY THAT DRIFTS IS WORSE THAN NO COPY — it would refuse handles
 *  the database would have taken, or promise one it will reject. The first draft of this
 *  list was written from memory and was wrong in both directions (it invented `bucket` and
 *  `health`, and missed fifty of these). So it is transcribed from
 *  `0283_a_person_needs_a_name_to_be_found_by.sql` § `handle_is_reserved`, and
 *  `publicProfile.test.ts` reads that migration and fails if the two ever disagree.
 *
 *  The server checks it too. This exists only so the field can say so before a round trip. */
export const RESERVED_HANDLES = [
  'about',
  'account',
  'admin',
  'administrator',
  'anon',
  'api',
  'app',
  'assets',
  'auth',
  'blog',
  'contact',
  'data',
  'delete',
  'edit',
  'event',
  'events',
  'explore',
  'export',
  'follow',
  'followers',
  'following',
  'help',
  'home',
  'import',
  'inbox',
  'insights',
  'integrations',
  'login',
  'logout',
  'map',
  'me',
  'messages',
  'new',
  'null',
  'owner',
  'people',
  'person',
  'photo',
  'photos',
  'place',
  'places',
  'privacy',
  'profile',
  'profiles',
  'public',
  'root',
  'search',
  'settings',
  'signin',
  'signup',
  'static',
  'support',
  'system',
  'terms',
  'trash',
  'trip',
  'trips',
  'undefined',
  'user',
  'users',
  'you',
] as const;

const RESERVED = new Set<string>(RESERVED_HANDLES);

/**
 * Why this handle will be refused, in words a person can act on — or null if it is fine.
 *
 * The ORDER matters: the most specific complaint wins, because "2 to 30 characters,
 * lowercase letters, numbers and underscores" is true of every rejection and tells
 * somebody who typed `Erica` nothing about what to do next.
 */
export function whyHandleIsInvalid(raw: string): string | null {
  const h = raw.trim();
  if (!h) return 'Pick a handle first.';
  if (/[A-Z]/.test(h)) return 'Handles are lowercase — try ' + h.toLowerCase() + '.';
  if (/\s/.test(h)) return 'No spaces. Use an underscore instead.';
  if (h.length < 2) return 'Too short — at least 2 characters.';
  if (h.length > 30) return 'Too long — 30 characters at most.';
  if (!/^[a-z0-9]/.test(h)) return 'Start with a letter or a number.';
  if (!/^[a-z0-9_]+$/.test(h)) return 'Letters, numbers and underscores only.';
  if (RESERVED.has(h)) return `"${h}" is reserved — it is part of an address in the app.`;
  if (!HANDLE_RE.test(h)) return 'That handle will not work.';
  return null;
}

/** A first suggestion from a display name — what most people would have typed anyway.
 *  Returns '' when nothing usable survives, so the caller shows an empty field rather
 *  than a handle nobody chose. */
export function suggestHandle(displayName: string | null | undefined): string {
  if (!displayName) return '';
  const h = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  return whyHandleIsInvalid(h) === null ? h : '';
}

/** What a stranger can currently see, in one sentence — so the card states the outcome
 *  rather than leaving four switches to be added up. */
export function whatAStrangerSees(p: {
  profile_visibility?: string | null;
  public_stats?: boolean | null;
  public_places?: boolean | null;
  public_activity?: boolean | null;
  handle?: string | null;
}): string {
  if (!p.handle) return 'Nothing — you have no handle yet, so there is no page to find.';
  if (p.profile_visibility !== 'public') {
    return 'Nothing. Your profile is private, so searching for you finds no one.';
  }
  const on = [
    p.public_stats ? 'your totals' : null,
    p.public_places ? 'your places' : null,
    p.public_activity ? 'your recent outings' : null,
  ].filter(Boolean) as string[];
  if (on.length === 0) return 'Your name and handle, and nothing else.';
  if (on.length === 1) return `Your name and handle, and ${on[0]}.`;
  return `Your name and handle, ${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}.`;
}

export interface PublicProfile {
  handle: string | null;
  handle_claimed: boolean;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  profile_visibility: string;
  public_stats: boolean;
  public_places: boolean;
  public_activity: boolean;
}

/** Claim the handle. Once — see 0283. Returns the handle the server settled on. */
export async function claimHandle(handle: string): Promise<string> {
  const { data, error } = await supabase.rpc('set_handle', { p_handle: handle });
  if (error) throw error;
  return data as string;
}

/** Save any part of the card. Omitted keys are left alone by the function itself. */
export async function savePublicProfile(patch: {
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  visibility?: 'private' | 'public';
  stats?: boolean;
  places?: boolean;
  activity?: boolean;
}): Promise<PublicProfile> {
  const { data, error } = await supabase.rpc('save_public_profile', {
    p_display_name: patch.display_name ?? undefined,
    p_avatar_url: patch.avatar_url ?? undefined,
    p_bio: patch.bio ?? undefined,
    p_visibility: patch.visibility ?? undefined,
    p_stats: patch.stats ?? undefined,
    p_places: patch.places ?? undefined,
    p_activity: patch.activity ?? undefined,
  });
  if (error) throw error;
  return data as unknown as PublicProfile;
}
