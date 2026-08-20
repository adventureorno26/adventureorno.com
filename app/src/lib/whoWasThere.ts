// What the "who was there" picker actually did, said out loud.
//
// WHY THIS EXISTS. 0236 and 0240–0242 changed what pressing `Together / Just me / Just Josh`
// MEANS: your own presence you state, anyone else you ASK. The screens could not have kept
// up, because all three RPCs returned `void` — so every one of the six places that call them
// did this:
//
//     await setPlaceSolo(place.id, profileId);
//     setSolo(profileId);              // ← and the screen now shows him as being there
//
// which is a worse failure than the one being fixed. Before, the app wrote something untrue
// to the database. After, it would write the right thing and tell the person the wrong one.
//
// 0243 makes each of them return { stated, asked, removed }. This turns that into a sentence.
import { showSnack } from './snackbar';

export interface WhoOutcome {
  /** Rows written because they were yours to write — your own presence. */
  stated: number;
  /** People a question went to. They are not on it until they answer. */
  asked: string[];
  /** Rows taken off. Never anyone's own recording, or their own evidence for the day. */
  removed: number;
}

const EMPTY: WhoOutcome = { stated: 0, asked: [], removed: 0 };

/** Whatever the RPC returned, as an outcome. An older deploy answering `null` reads as
 *  "nothing to report" rather than throwing — the picker still worked. */
export function asOutcome(data: unknown): WhoOutcome {
  if (!data || typeof data !== 'object') return EMPTY;
  const d = data as Partial<WhoOutcome>;
  return {
    stated: typeof d.stated === 'number' ? d.stated : 0,
    asked: Array.isArray(d.asked) ? d.asked.filter((x): x is string => typeof x === 'string') : [],
    removed: typeof d.removed === 'number' ? d.removed : 0,
  };
}

/** One outcome for a batch — the photo sorter sets who was there on every touched visit at
 *  once, and one sentence about all of them beats a snack per visit. */
export function mergeOutcomes(list: WhoOutcome[]): WhoOutcome {
  const asked = new Set<string>();
  let stated = 0;
  let removed = 0;
  for (const o of list) {
    stated += o.stated;
    removed += o.removed;
    for (const id of o.asked) asked.add(id);
  }
  return { stated, asked: [...asked], removed };
}

type Person = { id: string; display_name?: string | null };

const nameList = (ids: string[], people: Person[]): string => {
  const names = ids.map((id) => people.find((p) => p.id === id)?.display_name?.trim() || 'them');
  if (names.length <= 1) return names[0] ?? 'them';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/** The sentence, or null when there is nothing worth interrupting for.
 *
 *  Only ASKING gets announced. Stating your own presence and removing somebody are both
 *  visible on the screen that did them, and a snack confirming what you can already see is
 *  noise; a question that went to someone else is the one thing you cannot see. */
export function whoOutcomeMessage(o: WhoOutcome, people: Person[]): string | null {
  if (!o.asked.length) return null;
  return `Asked ${nameList(o.asked, people)}. It counts for them once they say yes.`;
}

/** Show it, if there is anything to show. */
export function announceWho(o: WhoOutcome, people: Person[]): void {
  const message = whoOutcomeMessage(o, people);
  if (message) showSnack({ message });
}
