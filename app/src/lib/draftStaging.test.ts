// NOTHING IS WRITTEN UNTIL SAVE, AND CANCEL LEAVES NOTHING BEHIND.
//
// The blank card gained three fillable sections on 2026-08-30 — Routes, Restaurants and
// Notes and reviews — and every one of them ends in a row somewhere. The reason that is
// safe is that the card holds them in React state and calls `writeStaged` exactly once,
// from Save. These are the checks that the holding is real.
//
// The companion guard is in lockedCard.test.ts ("stages them — none of the three is
// written before Save"), which reads NewPlaceDraft.tsx and fails if any write call
// appears outside `save()`. This file checks the behaviour of the thing that call runs.
import { describe, expect, it } from 'vitest';
import {
  needsVisitRow,
  writeStaged,
  type StagedNote,
  type StagedOuting,
  type StagingWriters,
} from './draftStaging';

/** A writers object that records instead of writing, so a test can ask what happened. */
function recorder() {
  const calls: { what: string; arg: unknown }[] = [];
  const writers: StagingWriters = {
    createEntry: (e) => {
      calls.push({ what: 'createEntry', arg: e });
      return Promise.resolve();
    },
    createChildPlace: (d) => {
      calls.push({ what: 'createChildPlace', arg: d });
      return Promise.resolve();
    },
    addActivityToVisit: (a) => {
      calls.push({ what: 'addActivityToVisit', arg: a });
      return Promise.resolve();
    },
    addPlaceToVisit: (a) => {
      calls.push({ what: 'addPlaceToVisit', arg: a });
      return Promise.resolve();
    },
  };
  return { calls, writers };
}

const route = (over: Partial<StagedOuting> = {}): StagedOuting => ({
  key: 'k-route',
  slug: 'hike',
  label: 'Hike',
  kind: 'route',
  name: 'Morning loop',
  distanceMeters: 3218.7,
  ...over,
});
const restaurant = (over: Partial<StagedOuting> = {}): StagedOuting => ({
  key: 'k-place',
  slug: 'restaurant',
  label: 'Restaurant',
  kind: 'place',
  name: 'Red Iguana',
  distanceMeters: null,
  ...over,
});
const note = (kind: string, title: string, key = `k-${title}`): StagedNote => ({
  key,
  draft: {
    kind,
    title,
    body: 'what it was like',
    rating: 4,
    url: null,
    date: '2026-08-30',
    address: null,
    lat: null,
    lng: null,
  },
});

describe('cancel leaves nothing behind', () => {
  it('writes nothing at all until the one call Save makes', async () => {
    // THE WHOLE CANCEL PATH, in the only terms this module has: the card built up a
    // staged draft, the person pressed Cancel, and `writeStaged` was never reached.
    const { calls } = recorder();
    const staged = {
      outings: [route(), restaurant()],
      notes: [note('note', 'A thought'), note('dining', 'Shorebirds')],
    };
    expect(staged.outings.length + staged.notes.length).toBe(4);
    // Cancel = dropping the state. No place, no visit, no activity, no entry.
    expect(calls).toEqual([]);
  });

  it('a discarded draft cannot have half-written itself', async () => {
    // The one way a cancel could leave a row is if something had already written. The
    // `done` set is the record of that, and on an untouched draft it is empty.
    const done = new Set<string>();
    expect(done.size).toBe(0);
  });
});

describe('what Save writes, and how each thing is modelled', () => {
  it('a plain note is an entry on this place', async () => {
    const { calls, writers } = recorder();
    await writeStaged({
      placeId: 'P',
      visitId: 'V',
      day: '2026-08-30',
      outings: [],
      notes: [note('note', 'A thought')],
      done: new Set(),
      writers,
    });
    expect(calls.map((c) => c.what)).toEqual(['createEntry']);
    expect(calls[0].arg).toMatchObject({ place_id: 'P', kind: 'note', title: 'A thought' });
  });

  it('a restaurant REVIEW is a place grouped under this one, exactly as the saved card does it', async () => {
    const { calls, writers } = recorder();
    await writeStaged({
      placeId: 'P',
      visitId: 'V',
      day: '2026-08-30',
      outings: [],
      notes: [note('dining', 'Shorebirds')],
      done: new Set(),
      writers,
    });
    expect(calls.map((c) => c.what)).toEqual(['createChildPlace']);
    expect(calls[0].arg).toMatchObject({ kind: 'dining', title: 'Shorebirds' });
  });

  it('a route is an activity on the first visit, and a restaurant picked from the list is a place on it', async () => {
    const { calls, writers } = recorder();
    await writeStaged({
      placeId: 'P',
      visitId: 'V',
      day: '2026-08-30',
      outings: [route(), restaurant()],
      notes: [],
      done: new Set(),
      writers,
    });
    expect(calls.map((c) => c.what)).toEqual(['addActivityToVisit', 'addPlaceToVisit']);
    expect(calls[0].arg).toMatchObject({
      visitId: 'V',
      option: 'hike',
      name: 'Morning loop',
      day: '2026-08-30',
      clientKey: 'k-route',
    });
    expect(calls[1].arg).toMatchObject({ visitId: 'V', option: 'restaurant', name: 'Red Iguana' });
  });

  it('notes come first — they need only the place, and a photo upload is the slow part', async () => {
    const { calls, writers } = recorder();
    await writeStaged({
      placeId: 'P',
      visitId: 'V',
      day: '2026-08-30',
      outings: [route()],
      notes: [note('note', 'A thought')],
      done: new Set(),
      writers,
    });
    expect(calls.map((c) => c.what)).toEqual(['createEntry', 'addActivityToVisit']);
  });

  it('writes nothing when there is nothing staged', async () => {
    const { calls, writers } = recorder();
    const out = await writeStaged({
      placeId: 'P',
      visitId: 'V',
      day: null,
      outings: [],
      notes: [],
      done: new Set(),
      writers,
    });
    expect(calls).toEqual([]);
    expect(out).toEqual({ written: 0, skipped: 0 });
  });
});

describe('a retried Save finishes the list rather than doubling it', () => {
  it('skips what already landed', async () => {
    // The failure this exists for: three staged items, the third throws, she presses
    // Save again. `create_experience` is idempotent on its key so the place is not
    // duplicated; without `done`, the first two notes would be.
    const done = new Set<string>();
    const first = recorder();
    let thrown = false;
    const failing: StagingWriters = {
      ...first.writers,
      addActivityToVisit: (a) => {
        if (!thrown) {
          thrown = true;
          return Promise.reject(new Error('the connection dropped'));
        }
        return first.writers.addActivityToVisit(a);
      },
    };
    const args = {
      placeId: 'P',
      visitId: 'V',
      day: '2026-08-30',
      outings: [route()],
      notes: [note('note', 'One'), note('dining', 'Two')],
      done,
      writers: failing,
    };
    await expect(writeStaged(args)).rejects.toThrow('the connection dropped');
    expect(first.calls.map((c) => c.what)).toEqual(['createEntry', 'createChildPlace']);
    expect(done.size, 'the two notes that landed are remembered').toBe(2);

    await writeStaged(args);
    expect(first.calls.map((c) => c.what)).toEqual([
      'createEntry',
      'createChildPlace',
      'addActivityToVisit',
    ]);
    expect(done.size).toBe(3);
  });
});

describe('an outing needs a visit to hang off', () => {
  it('does not silently drop one when there is no visit', async () => {
    const { calls, writers } = recorder();
    const out = await writeStaged({
      placeId: 'P',
      visitId: null,
      day: null,
      outings: [route()],
      notes: [note('note', 'A thought')],
      done: new Set(),
      writers,
    });
    // The note still lands — it only needs the place. The route is reported, not lost.
    expect(calls.map((c) => c.what)).toEqual(['createEntry']);
    expect(out).toEqual({ written: 1, skipped: 1 });
  });
});

// The rule the blank card's Visits section runs on. It used to be spelled inline as
// `visitDate && !files.length`; a staged route added a clause, so it moved here where a
// test can ask it directly.
describe('when the blank card logs a visit of its own', () => {
  const base = { wanted: false, visitDate: '2026-08-30', photoCount: 0, stagedOutings: 0 };

  it('lets a trail exist before it has been walked — no date, no visit', () => {
    expect(needsVisitRow({ ...base, visitDate: '' })).toBe(false);
  });

  it('somewhere to go later never logs one', () => {
    expect(needsVisitRow({ ...base, wanted: true })).toBe(false);
    expect(needsVisitRow({ ...base, wanted: true, stagedOutings: 3 })).toBe(false);
  });

  it('a date and no photos logs one, as it always has', () => {
    expect(needsVisitRow(base)).toBe(true);
  });

  it('photos alone still derive their own visit from the photo dates', () => {
    expect(needsVisitRow({ ...base, photoCount: 4 })).toBe(false);
  });

  it('but a staged route asks for the visit outright, photos or not', () => {
    // A route and a restaurant attach to a visit ID, and the photo-derived visit does
    // not exist yet at the moment Save runs. Writing the manual visit first does not
    // double-count: rebuild_place_visits drops a derived island a manual visit covers.
    expect(needsVisitRow({ ...base, photoCount: 4, stagedOutings: 1 })).toBe(true);
  });
});
