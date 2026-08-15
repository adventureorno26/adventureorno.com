// Who was there — as a list built from the real members, not a hardcoded pair.
//
// WHAT THIS REPLACES. Four files each declared `type Who = 'both' | 'mine' | 'josh'`
// and rendered a literal `<option value="josh">Just Josh</option>`, while resolving the
// id behind it as `people.find(p => p.id !== meId)` — "the other person". With exactly
// two members that works. With three it picks an arbitrary member and labels them
// "Josh", so the control names the wrong person and the save writes the wrong
// attribution. The whole point of the flok work is that a third person can join.
//
// The keys are deliberately profile ids rather than nicknames, so a choice cannot drift
// from the person it means. `both` and `mine` stay as words because they are roles in
// the sentence, not people: "mine" is whoever is signed in.
//
// WITH TWO MEMBERS THE OUTPUT IS UNCHANGED — "Together / Just me / Just Josh", in that
// order. Nothing about the card moves. The list only grows when someone else joins.

import type { MapPerson } from './data';

/** A single option in a "who was there" control. */
export interface WhoChoice {
  /** Stable value for the <option>/<button>: 'both', 'mine', or a profile id. */
  key: string;
  /** What the person reads. */
  label: string;
  /** The profile to attribute to — null means everyone. */
  profileId: string | null;
}

/** The word for "all of us". It is TOGETHER, always.
 *
 * This used to default to "Both" and say "Together" only when a caller asked for it, so
 * the same idea appeared under two words on different screens — Erica, 2026-08-15: "the
 * view is Together so investigate why you are saying Both". The style option is gone
 * rather than re-defaulted, because an option is how the wrong word came back. */
export function everyoneLabel(people: MapPerson[]): string {
  if (people.length > 2) return 'Everyone';
  // Three people are not "together" as a pair — that word means the two of them.
  return people.length > 2 ? 'Everyone' : 'Together';
}

/**
 * Build the choices from the members who actually exist.
 *
 * `meId` is listed as "Just me" wherever they appear; everyone else is named. Members
 * without a display name fall back to a neutral placeholder rather than a guess.
 */
export function whoChoices(
  people: MapPerson[],
  meId: string | null | undefined,
): WhoChoice[] {
  const out: WhoChoice[] = [
    { key: 'both', label: everyoneLabel(people), profileId: null },
  ];
  if (meId) out.push({ key: 'mine', label: 'Just me', profileId: meId });
  for (const p of people) {
    if (!meId || p.id !== meId) {
      out.push({ key: p.id, label: `Just ${p.display_name ?? 'them'}`, profileId: p.id });
    }
  }
  return out;
}

/** Which choice a stored attribution corresponds to. `null` attribution = everyone. */
export function whoKey(soloProfile: string | null | undefined, meId: string | null | undefined) {
  if (soloProfile == null) return 'both';
  if (meId && soloProfile === meId) return 'mine';
  return soloProfile;
}

/** The profile a chosen key attributes to. `null` = everyone. */
export function whoProfileId(key: string, meId: string | null | undefined): string | null {
  if (key === 'both') return null;
  if (key === 'mine') return meId ?? null;
  return key;
}
