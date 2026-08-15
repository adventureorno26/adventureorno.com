// A COUNT THAT DECIDES SOMETHING MUST BE COUNTED, NOT REMEMBERED.
//
// `places.visit_count` is a mirror. Nothing refreshes it when a VISIT changes —
// create_visit, delete_visit, merge_visits and update_visit_dates all leave it behind —
// so it drifts every time two visits are merged into one. Production had the
// Appalachian Trail on 39 against 32 real visits (migration 0190).
//
// That was not cosmetic. The Duplicates screen chooses which of two places SURVIVES A
// MERGE by that number — "the more-visited one wins" — and a merge is not undone by
// pressing it again. Smart Albums decided "places we've been more than once" by it too.
//
// Both now ask `place_visit_totals()`, which counts rows at the moment of asking. This
// test exists because the column is still THERE: it is easy to reach for, it reads like
// an answer, and the next person to want a visit count will find it first.
import { describe, expect, it } from 'vitest';

// TWO PATTERNS, AND THE SECOND ONE IS NOT REDUNDANT. `../**` from inside lib/ returns
// 123 files and not one of them from lib/ itself — the directory holding this test is
// the one place it does not look. `./*` is what makes lib/data.ts visible.
const RAW = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SOURCES = Object.entries(RAW).filter(([path]) => !/\.test\.tsx?$/.test(path));

// The keys are relative to THIS file, so a sibling in lib/ comes back as './data.ts'
// rather than '../lib/data.ts'. Worth stating: my first attempt matched on
// 'lib/data.ts', got nothing, and I briefly took the empty result for a hole in the
// glob rather than a mistake in the lookup.
const source = (name: string) => SOURCES.find(([p]) => p.endsWith(name))?.[1] ?? '';

const DUPLICATES = source('routes/Duplicates.tsx');
const ALBUMS = source('routes/SmartAlbums.tsx');
const DATA = source('./data.ts');

describe('the screens that decide by a visit count', () => {
  it('Duplicates picks the survivor from a counted total', () => {
    expect(DUPLICATES, 'it must load the reader').toMatch(/fetchPlaceVisitTotals/);
    // The winner is chosen through the helper, not from the row.
    expect(DUPLICATES).toMatch(/visitsOf\(p\) >= visitsOf\(q\)/);
  });

  it('Duplicates shows the counted number, not the stored one', () => {
    // Showing one number and deciding by another would be worse than either.
    expect(DUPLICATES).not.toMatch(/\{pair\.[ab]\.visit_count/);
  });

  it('"more than once" is counted', () => {
    expect(ALBUMS).toMatch(/fetchPlaceVisitTotals/);
    expect(ALBUMS).not.toMatch(/\(p\.visit_count \?\? 0\) > 1/);
  });

  it('the reader asks the database for a total, not for a view', () => {
    // place_visit_counts(profile) answers "in THIS view", and its null means SHARED
    // visits — not everyone's. A merge is not asked from inside a view, which is the
    // whole reason place_visit_totals exists.
    expect(DATA).toMatch(/place_visit_totals/);
    const fn = /export async function fetchPlaceVisitTotals[\s\S]*?\n\}/.exec(DATA)?.[0] ?? '';
    expect(fn, 'it must not quietly call the per-view reader').not.toMatch(/place_visit_counts/);
  });

  it('says why the column is not the answer, so the next person does not reach for it', () => {
    // The column is still in Place and still selected. The comment is the only thing
    // standing between it and the next visit count someone needs.
    expect(DATA).toMatch(/mirror nobody refreshes/);
  });
});
