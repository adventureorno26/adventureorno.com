// THE SCOPE A NUMBER IS ABOUT — §0.2, approved 2026-08-30.
//
// Erica: *"This is not a household app. This is a social application."* There are exactly
// THREE scopes and no operator:
//
//   My Stats           every card I am tagged on, solo or not. Everything opens here.
//   Our Stats          only the cards ALL the selected people AND I are tagged on. The
//                      overlap, never the union. Tagging someone means we did it together.
//   A person's own     all of theirs. Seen by opening their profile — never a pill on my map.
//
// I AM ALWAYS IN THE SET. That is what makes the second scope *Our* Stats rather than
// "some people": adding Josh asks what he and I both did, and adding Maya as well asks what
// all three of us did. Strict intersection; it gets small quickly and that is correct.
//
// THIS LIVES IN `lib`, NOT IN THE CONTROL, on purpose. Settings ▸ Stats, /insights and the
// map each have to decide what scope they open on and what to call it, and the last time
// two of them decided that privately one said 17 Trips and the other said 56 (0280). A
// screen may render the scope however it likes; it may not define one.
import type { PersonContact } from './memoryPeople';

export interface PeopleSelection {
  /** Me, plus anyone whose stats are being intersected with mine. Never empty. */
  people: string[];
  /** Pinned. The type is the enforcement: no caller can express the retired ANY operator,
   *  which asked for a list of things at least one of us did — two histories shuffled
   *  together, not a shared one. Every reader still takes a `p_mode` on the wire. */
  mode: 'all';
}

/** MY STATS — the scope everything opens on.
 *
 *  Null until the contact list has loaded, because guessing it as "no people" is the
 *  retired everybody-question: the screen would show that answer for a frame and then
 *  correct itself, which reads as the number changing while you look at it. */
export function myStats(contacts: PersonContact[]): PeopleSelection | null {
  const me = contacts.find((p) => p.is_me);
  return me ? { people: [me.id], mode: 'all' } : null;
}

/** The people in the scope other than me, in the order the contact list gives them. */
export function othersInScope(value: PeopleSelection, contacts: PersonContact[]): PersonContact[] {
  const me = contacts.find((p) => p.is_me);
  return contacts.filter((p) => p.id !== me?.id && value.people.includes(p.id));
}

/** THE NAME OF THE SCOPE, from one place. Two screens showing the same number under two
 *  different words is the same defect as two screens showing two numbers. */
export function scopeLabel(value: PeopleSelection, contacts: PersonContact[]): string {
  return othersInScope(value, contacts).length === 0 ? 'My Stats' : 'Our Stats';
}

/** What the number actually counts, naming everybody it depends on. */
export function scopeSentence(value: PeopleSelection, contacts: PersonContact[]): string {
  const names = othersInScope(value, contacts).map((p) => p.display_name);
  if (names.length === 0) return 'Every card you are tagged on.';
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Only the cards you and ${list} are all tagged on.`;
}
