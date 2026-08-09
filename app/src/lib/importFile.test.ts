// The naming rule for imported activity files.
//
// This is the regression that produced 181 activities called "Morning Walk":
// activityName() invented a name from the clock when the filename was an export.
// Erica: "I want the names of real places, not 'morning walk'." An export-shaped
// filename must now yield '' so import_file_activity (migration 0147) names the
// row after the place it geocodes to — and a name a person wrote must survive.

import { describe, expect, it } from 'vitest';
import { activityName } from './importFile';

const AT = Date.UTC(2018, 0, 14, 14, 34);

describe('activityName', () => {
  it('sends nothing for a bulk-export filename, so the server names it by place', () => {
    for (const f of [
      'hiking 2018-01-14 14:34.gpx',
      'running_2020-05-02.tcx',
      'cycling-2021-11-03 07:02.gpx',
      '2018-01-14T09-12-00.gpx',
      'activity_8811.fit',
      'activity8811.fit',
    ]) {
      expect(activityName(f, 'Hike', AT), f).toBe('');
    }
  });

  it('never invents a time-of-day name again', () => {
    // The exact strings this function used to produce, now rejected as input too,
    // so a re-import of an already-exported file cannot reintroduce them.
    for (const f of [
      'Morning Walk.gpx',
      'Evening Hike.gpx',
      'Lunch Run.gpx',
      'Night Ride.gpx',
      'Late Night Walk.gpx',
    ]) {
      expect(activityName(f, 'Walk', AT), f).toBe('');
    }
    // And a bare activity type says nothing either.
    expect(activityName('Hike.gpx', 'Hike', AT)).toBe('');
    expect(activityName('walk.fit', 'Walk', AT)).toBe('');
  });

  it('keeps a name a person actually wrote', () => {
    expect(activityName('Old Rag with Josh.gpx', 'Hike', AT)).toBe('Old Rag with Josh');
    expect(activityName('Eagle Rock Hike w Josh.fit', 'Hike', AT)).toBe('Eagle Rock Hike w Josh');
    expect(activityName('Seneca Regional Park.gpx', 'Hike', AT)).toBe('Seneca Regional Park');
  });

  it('does not eat a real name that happens to contain a time word', () => {
    // NEGATIVE CONTROL. "Morning Glory Trail" is a place; "Sunday Morning Ramble"
    // is a person's words. A rule that swallowed these would be worse than the bug.
    expect(activityName('Morning Glory Trail.gpx', 'Hike', AT)).toBe('Morning Glory Trail');
    expect(activityName('Sunday Morning Ramble with Josh.gpx', 'Walk', AT)).toBe(
      'Sunday Morning Ramble with Josh',
    );
    expect(activityName('Walk the Line 10k.gpx', 'Run', AT)).toBe('Walk the Line 10k');
  });

  it('is independent of the clock — the same file names the same way at any hour', () => {
    const morning = Date.UTC(2018, 0, 14, 13, 0);
    const evening = Date.UTC(2018, 0, 14, 23, 0);
    expect(activityName('hiking 2018-01-14 14:34.gpx', 'Hike', morning)).toBe(
      activityName('hiking 2018-01-14 14:34.gpx', 'Hike', evening),
    );
    expect(activityName('Old Rag with Josh.gpx', 'Hike', morning)).toBe(
      activityName('Old Rag with Josh.gpx', 'Hike', evening),
    );
  });
});
