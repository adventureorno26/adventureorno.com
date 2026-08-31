// People you can TAG, in the model §8b-i asked for: a person is a person, not an account.
//
// NOT `people.ts`, which is next door and is about MEMBERSHIP — who can sign in to this
// space, invites, roles. The two words are the same and the subjects are not: that file
// answers "who has an account here", this one answers "who was in this". Keeping them apart
// is the point of §8b-i's "account access separate from memory participation".
//
// Before 0247 a participant had to point at `profiles`, so the only people who could ever
// appear in this app were the two who can sign in to it. A friend, a parent, a child on a
// hike — none of them could be recorded, and 178 photos had no participants of any kind
// because photos were never given a participant table at all.
//
// Everything here goes through RPCs. The tables carry SELECT for the browser and nothing
// else (0176), and the write rules — your own presence is yours to state, somebody with an
// account is asked, somebody without one is your statement and says so — live in the
// database where they cannot be forgotten by a screen.
import { supabase } from './supabase';

export interface PersonContact {
  id: string;
  display_name: string;
  /** Set when this person also signs in here. Null is normal, not missing data. */
  linked_profile: string | null;
  favourite: boolean;
  is_me: boolean;
}

export interface PhotoPerson {
  person_id: string;
  display_name: string;
  /** `proposed` means they have been asked and have not answered. */
  participation_status: 'proposed' | 'accepted';
  verification_status: 'unverified' | 'confirmed_by_person' | 'confirmed_by_owner';
  linked_profile: string | null;
}

export interface TagOutcome {
  subject: string;
  participation: 'proposed' | 'accepted';
  verification: string;
  /** True when a question went to somebody, so the screen can say so rather than
   *  showing a tag as a fact it is not yet (the 0243 lesson, applied here first). */
  asked: boolean;
}

export async function fetchMyPeople(): Promise<PersonContact[]> {
  const { data, error } = await supabase.rpc('my_people');
  if (error) throw error;
  return (data ?? []) as PersonContact[];
}

/** A person you record. No account required — that is the whole point. */
export async function addContact(
  displayName: string,
  linkedProfile?: string | null,
  favourite = false,
): Promise<string> {
  const { data, error } = await supabase.rpc('add_contact', {
    p_display_name: displayName,
    ...(linkedProfile ? { p_linked_profile: linkedProfile } : {}),
    p_favourite: favourite,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function fetchPhotoPeople(photoId: string): Promise<PhotoPerson[]> {
  const { data, error } = await supabase.rpc('photo_people', { p_photo: photoId });
  if (error) throw error;
  return (data ?? []) as PhotoPerson[];
}

export async function tagPersonOnPhoto(photoId: string, personId: string): Promise<TagOutcome> {
  const { data, error } = await supabase.rpc('tag_person_on_photo', {
    p_photo: photoId,
    p_person: personId,
  });
  if (error) throw error;
  return data as unknown as TagOutcome;
}

/** Retracts, never deletes — the same rule as everywhere else. */
export async function untagPersonOnPhoto(photoId: string, personId: string): Promise<void> {
  const { error } = await supabase.rpc('untag_person_on_photo', {
    p_photo: photoId,
    p_person: personId,
  });
  if (error) throw error;
}

export interface MemoryTagToConfirm {
  subject_id: string;
  kind: string;
  photo_id: string | null;
  tagged_by: string | null;
  /** The card's name — a place for a visit, the activity's name for an outing.
   *  NULL when you are not entitled to it: 0301 gates it on sharing a space with the
   *  subject, or having ADDED the tagger. Erica, 2026-08-31: "You can see the full card
   *  if you add someone." */
  card: string | null;
  created_at: string;
}

export async function fetchMemoryTagsToConfirm(): Promise<MemoryTagToConfirm[]> {
  const { data, error } = await supabase.rpc('my_memory_tags_to_confirm');
  if (error) throw error;
  return (data ?? []) as MemoryTagToConfirm[];
}

export async function respondToMemoryTag(subjectId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_to_memory_tag', {
    p_subject: subjectId,
    p_accept: accept,
  });
  if (error) throw error;
}

export interface PersonMemory {
  kind: 'photo' | 'outing' | 'visit';
  id: string;
  happened_on: string | null;
  title: string | null;
  place_id: string | null;
  place_name: string | null;
  distance: number | null;
  /** `proposed` means they have been asked and have not answered — never counted as agreed. */
  status: 'accepted' | 'proposed';
}

/** Everything done with ONE OR SEVERAL people.
 *
 *  §8b-i: "Remove Together / Just me / Just Josh as the permanent model; **Together is a
 *  people query with ALL selected**." So the general question is the primitive and one
 *  person is the degenerate case — `person_memories` is a wrapper over this in SQL.
 *
 *    all  everybody named was on it   → "what did we do together"
 *    any  at least one of them was
 *
 *  Verified against production the day it shipped: 375 outings for her, 127 for him, 55
 *  together and 447 for either — which adds up exactly (375 + 127 − 55 = 447). */
/** Everything these people are on. `mode` is PINNED to `'all'` — the intersection.
 *
 *  It used to take `'all' | 'any'`, and §0.2 retired the operator on 2026-08-30: ANY asks
 *  for the memories at least one of them was on, which is two histories shuffled together
 *  rather than a shared one. The wire still carries `p_mode` because the database function
 *  still takes it; the TYPE is what stops a caller expressing the retired question. */
export async function fetchMemoriesWithPeople(
  personIds: string[],
  mode: 'all' = 'all',
  from?: string,
  to?: string,
): Promise<PersonMemory[]> {
  const { data, error } = await supabase.rpc('memories_with_people', {
    p_people: personIds,
    p_mode: mode,
    ...(from ? { p_from: from } : {}),
    ...(to ? { p_to: to } : {}),
  });
  if (error) throw error;
  return (data ?? []) as PersonMemory[];
}

/** Everything you did with one person, through ONE door.
 *
 *  A person's memories currently live in three places — memory_people for photos,
 *  activity_profiles for outings, visit_profiles for visits — and §8b-i calls the last two
 *  "migration inputs, not the final commercial API". When they fold into the registry, one
 *  SQL function changes and every screen that asked follows. A second reader written straight
 *  against activity_profiles today is a second thing to find and repoint later. */
export async function fetchPersonMemories(
  personId: string,
  from?: string,
  to?: string,
): Promise<PersonMemory[]> {
  const { data, error } = await supabase.rpc('person_memories', {
    p_person: personId,
    ...(from ? { p_from: from } : {}),
    ...(to ? { p_to: to } : {}),
  });
  if (error) throw error;
  return (data ?? []) as PersonMemory[];
}
