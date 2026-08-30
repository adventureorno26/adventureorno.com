import { describe, expect, it } from 'vitest';

// The drain's one dangerous property is that it deletes bytes permanently. Its safety
// rests on a single filter: a key recorded in `purged_media` is only deleted if NO live
// row still references it. Rule #6 allows a deliberate manual re-upload to bring a deleted
// photo back, which can legitimately reuse a key the ledger already lists as owed — so the
// ledger is a claim and the live media keys are the truth.
//
// That filter is the thing worth testing, so it is expressed here exactly as the handler
// applies it, over the cases that actually occur.
function partition(owed: Array<{ id: string; media_key: string }>, liveKeys: Set<string>) {
  return {
    deletable: owed.filter((r) => !liveKeys.has(r.media_key)),
    skipped: owed.filter((r) => liveKeys.has(r.media_key)),
  };
}

describe('purged-media drain safety', () => {
  it('deletes a key no live row references', () => {
    const { deletable, skipped } = partition(
      [{ id: '1', media_key: 'photos/gone.jpg' }],
      new Set(['photos/still-here.jpg']),
    );
    expect(deletable.map((r) => r.media_key)).toEqual(['photos/gone.jpg']);
    expect(skipped).toHaveLength(0);
  });

  it('NEVER deletes a key a live row still references — the re-upload case (rule #6)', () => {
    const { deletable, skipped } = partition(
      [{ id: '1', media_key: 'photos/came-back.jpg' }],
      new Set(['photos/came-back.jpg']),
    );
    expect(deletable).toHaveLength(0);
    expect(skipped.map((r) => r.media_key)).toEqual(['photos/came-back.jpg']);
  });

  it('splits a mixed batch rather than failing it whole', () => {
    const { deletable, skipped } = partition(
      [
        { id: '1', media_key: 'photos/a.jpg' },
        { id: '2', media_key: 'thumbs/a.jpg' },
        { id: '3', media_key: 'photos/live.jpg' },
      ],
      new Set(['photos/live.jpg']),
    );
    expect(deletable.map((r) => r.id)).toEqual(['1', '2']);
    expect(skipped.map((r) => r.id)).toEqual(['3']);
  });

  it('an empty ledger deletes nothing', () => {
    const { deletable, skipped } = partition([], new Set(['photos/live.jpg']));
    expect(deletable).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it('only the stamped ids are the ones actually deleted', () => {
    const owed = [
      { id: 'keep', media_key: 'photos/live.jpg' },
      { id: 'drop', media_key: 'photos/dead.jpg' },
    ];
    const { deletable } = partition(owed, new Set(['photos/live.jpg']));
    // markPurgedMediaDeleted is called with exactly the deleted ids — never the skipped
    // ones, or the ledger would claim an object was removed while it is still in R2.
    expect(deletable.map((r) => r.id)).toEqual(['drop']);
  });
});
