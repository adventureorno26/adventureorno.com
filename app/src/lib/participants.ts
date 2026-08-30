// WHO WAS THERE — a list of names, not a vocabulary.
//
// THE RULING. Erica, 2026-08-30: *"yes, people picker."* The attribution control — "who
// was on this visit" — is now a picker: you tag whoever was there, by name, any number of
// them. `Just me` becomes tagging nobody else. `Together` becomes tagging Josh.
//
// WHAT THIS REPLACES, AND WHY TWICE. This file used to build a list of CHOICES
// (`whoChoices()`), because before it the seven surfaces each declared
// `type Who = 'both' | 'mine' | 'josh'` and rendered `<option value="josh">` — a person
// hardcoded into the app. Collapsing them onto one generated list fixed the hardcoding
// and left the vocabulary: `Together / Just me / Just <name>`, which §0.2 then retired
// along with everything else the household model had. §0.2 supplied a replacement for the
// SCOPE words (My Stats / Our Stats — see lib/statsScope) and none for the attribution
// words, because "who was on this visit" is a different question from "whose numbers are
// these". This is that replacement, and it is a different SHAPE rather than a different
// word: the answer is the set of people, so the control is the set of people.
//
// THE VALUE IS A SET OF PROFILE IDS, and nothing else. Never a nickname, never a keyword
// standing in for a person, never a null that a reader has to interpret — a null was how
// `solo_profile` said "everyone", which is the reading that could not survive a third
// member and the one §0.2 retired as the "null-person scope". An empty set means one
// thing only: it was just you, and `whoForWrite()` says so explicitly by returning `[you]`.
//
// WHAT THE DATABASE CAN STORE, said here because the picker's shape depends on it:
//
//   a VISIT      any set of people — `set_visit_participants(p_visit, uuid[])`, the
//                function `set_visit_solo` has been a one-element wrapper around since
//                0243. Full multi-select, faithfully.
//   a PLACE      ONE name — `set_place_solo(p_place, p_profile)`.
//   an OUTING    ONE name — `set_activity_solo(p_activity, p_profile)`.
//
// So the picker takes a CAPACITY, and the surfaces that write a whole place or an outing
// pass `'one'`: those tick a single name and say why in the sheet. They do not offer a
// multi-select that would have to be quietly collapsed on the way to the database, which
// is worse than the buttons it replaced. Lifting the limit is a migration —
// `set_place_participants(uuid, uuid[])` and `set_activity_participants(uuid, uuid[])`
// beside the visit one — and migrations were out of scope for this change.

/** Anyone who can be tagged. Structural on purpose: `MapPerson` (what `map_people`
 *  returns) satisfies it, and so does anything else carrying a name and an id. */
export interface WhoPerson {
  id: string;
  display_name: string | null;
}

/** How many names the record behind a control can actually hold. */
export type WhoCapacity = 'many' | 'one';

/** The picked ids, in the order the people themselves are listed, with you first.
 *  A stored list arrives in whatever order the reader produced it; a control that
 *  reordered itself as you ticked would look like it was losing your choices. */
export function orderWho(
  ids: string[],
  people: WhoPerson[],
  meId: string | null | undefined,
): string[] {
  const want = new Set(ids);
  const out: string[] = [];
  if (meId && want.has(meId)) out.push(meId);
  for (const p of people) if (p.id !== meId && want.has(p.id)) out.push(p.id);
  // Anyone tagged who is not in the list of people we can name — kept rather than
  // dropped, because dropping them would silently untag somebody on the next save.
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

/** What one person is called on the control. You are "You"; everybody else is their own
 *  name, read from the record. A person with no display name is not guessed at. */
export function whoName(id: string, people: WhoPerson[], meId: string | null | undefined): string {
  if (meId && id === meId) return 'You';
  return people.find((p) => p.id === id)?.display_name?.trim() || 'someone';
}

/** The names, as a sentence: "You", "You and Josh", "You, Josh and Sam". */
export function whoLabel(
  ids: string[],
  people: WhoPerson[],
  meId: string | null | undefined,
): string {
  const names = orderWho(ids, people, meId).map((id) => whoName(id, people, meId));
  // An empty tagging is not an empty answer — it is "it was just you" (Erica,
  // 2026-08-30), so the control reads as that answer rather than as a gap.
  if (names.length === 0) return meId ? 'You' : 'Nobody yet';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The participant list to WRITE. Empty means it was just you, so it writes you —
 * `set_visit_participants` refuses an empty list outright ("a visit needs at least one
 * participant"), and it is right to: a visit nobody was on is not a record of anything.
 */
export function whoForWrite(ids: string[], meId: string | null | undefined): string[] {
  if (ids.length) return ids;
  return meId ? [meId] : [];
}

/**
 * The ONE profile id a place-level or outing-level write can store.
 *
 * Only ever reached where the picker's capacity is `'one'`, so there is at most one id to
 * return and nothing is being collapsed here. It exists so those paths cannot quietly be
 * handed a set of two and keep the first: that would be the picker lying about what it
 * saved, which is the one failure worse than the control it replaced.
 */
export function whoSingle(ids: string[], meId: string | null | undefined): string | null {
  const write = whoForWrite(ids, meId);
  if (write.length > 1) {
    throw new Error('this record holds one name — the picker should have capacity "one"');
  }
  return write[0] ?? null;
}
