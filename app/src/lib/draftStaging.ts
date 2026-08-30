// WHAT THE BLANK CARD IS HOLDING, AND THE ONE PLACE IT IS WRITTEN.
//
// Erica, 2026-08-30: "I also think Add should lead to a card where I can add an
// activity, restaurant, notes, etc — it should be fully editable."
//
// That settles a question STATE.md had recorded as open since 2026-08-12: an activity
// attaches to a VISIT, and a blank card has no visit until Save, so Routes and
// Restaurants read "Added once this first visit is saved". The answer is not to create
// the place early and treat the card as a draft — it is to STAGE, which is the promise
// the card already makes about the name, the rating, the tags, the date and the photos:
// "Everything staged; nothing written until Save."
//
// So this module holds two things and nothing else:
//
//   1. The SHAPE of what a blank card can be holding — routes, restaurants and notes
//      that exist only in React state until Save.
//   2. `writeStaged`, the ONE function that turns that state into rows, called from
//      exactly one place (NewPlaceDraft's `save`), after the place and its first visit
//      exist. Nothing here reaches for a network client of its own: every write is a
//      function handed in by the caller, which is what makes it testable and what makes
//      "Cancel leaves nothing behind" a fact rather than an intention.
//
// `done` is why a retry is safe. `create_experience` is idempotent on its key, so a
// second Save after a dropped connection returns the same place; the staged items have
// no such key, so the set records the ones already written and the retry skips them.
import type { NewEntry } from './types';

/** A route or a place staged on the blank card, from the "+ Add an activity" list.
 *  `kind` is the model decision the list itself carries: a Run is a ROUTE recorded on
 *  the visit; a Restaurant is a PLACE with a card and a visit of its own. */
export interface StagedOuting {
  /** Minted when it is staged and reused on every retry, so a retry cannot double it. */
  key: string;
  slug: string;
  label: string;
  kind: 'route' | 'place';
  name: string;
  distanceMeters: number | null;
}

/** A note or review staged on the blank card. The draft is exactly what the shared
 *  note form produces, minus the place id — which does not exist yet. */
export interface StagedNote {
  key: string;
  draft: Omit<NewEntry, 'place_id'>;
}

/** The writes, handed in. The blank card passes the same functions the saved card
 *  uses, so there is one way to add a restaurant and not two that drift. */
export interface StagingWriters {
  createEntry: (entry: NewEntry) => Promise<unknown>;
  /** A review of a restaurant IS a place under this one — the saved card's `addNote`
   *  does exactly this, and the Restaurants section is what it fills. */
  createChildPlace: (draft: Omit<NewEntry, 'place_id'>) => Promise<unknown>;
  addActivityToVisit: (a: {
    visitId: string;
    option: string;
    name: string | null;
    distanceMeters: number | null;
    clientKey: string;
    day: string | null;
  }) => Promise<unknown>;
  addPlaceToVisit: (a: {
    visitId: string;
    option: string;
    name: string;
    clientKey: string;
    day: string | null;
  }) => Promise<unknown>;
}

export interface StagedWriteResult {
  written: number;
  /** Outings that could not be written because there is no visit to hang them on.
   *  The card refuses to save in that state, so this is a belt, not a route. */
  skipped: number;
}

/**
 * Write everything the blank card was holding. Called ONCE, from Save, after the
 * place (and its first visit, when there is a date) exist.
 *
 * Notes go first because they need only the place; routes and restaurants need the
 * visit. Each item is marked done the moment it lands, so a Save retried after a
 * failure halfway down the list writes the rest and not the lot again.
 */
export async function writeStaged(args: {
  placeId: string;
  visitId: string | null;
  /** The visit's day. `add_activity_to_visit` refuses a day outside the visit, and a
   *  first visit is one day, so this is the only day any of them can have. */
  day: string | null;
  outings: StagedOuting[];
  notes: StagedNote[];
  done: Set<string>;
  writers: StagingWriters;
}): Promise<StagedWriteResult> {
  const { placeId, visitId, day, outings, notes, done, writers } = args;
  let written = 0;
  let skipped = 0;

  for (const note of notes) {
    if (done.has(note.key)) continue;
    // The kind decides the model, exactly as it does on the saved card: 'note' is an
    // entry on this place; anything else is a place of its own, grouped under it.
    if ((note.draft.kind || 'note') === 'note') {
      await writers.createEntry({ ...note.draft, place_id: placeId });
    } else {
      await writers.createChildPlace(note.draft);
    }
    done.add(note.key);
    written += 1;
  }

  for (const outing of outings) {
    if (done.has(outing.key)) continue;
    if (!visitId) {
      skipped += 1;
      continue;
    }
    if (outing.kind === 'route') {
      await writers.addActivityToVisit({
        visitId,
        option: outing.slug,
        name: outing.name.trim() || null,
        distanceMeters: outing.distanceMeters,
        clientKey: outing.key,
        day,
      });
    } else {
      await writers.addPlaceToVisit({
        visitId,
        option: outing.slug,
        name: outing.name.trim(),
        clientKey: outing.key,
        day,
      });
    }
    done.add(outing.key);
    written += 1;
  }

  return { written, skipped };
}

/**
 * Does this card have to log a visit row of its own?
 *
 * It always did when there was a date and NO photos — with photos the visit is derived
 * from the photo dates, and a manual one beside it would have been a second visit for
 * the same outing. A staged route or restaurant changes that: both attach to a visit
 * id, and the derived one does not exist yet at the moment Save runs. So a card holding
 * one asks for the visit outright.
 *
 * That does not reintroduce the double-count it was avoiding. `rebuild_place_visits`
 * drops a derived island that a MANUAL visit already covers ("An island already covered
 * by a MANUAL visit does not need a derived twin"), and the manual row is written before
 * the photos land.
 */
export function needsVisitRow(o: {
  wanted: boolean;
  visitDate: string;
  photoCount: number;
  stagedOutings: number;
}): boolean {
  if (o.wanted) return false; // somewhere to go later has no visit
  if (!o.visitDate) return false; // no date, no visit — a trail can exist unwalked
  return o.photoCount === 0 || o.stagedOutings > 0;
}
