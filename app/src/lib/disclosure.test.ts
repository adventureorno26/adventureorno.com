// The rule that stops four dropdowns sitting open at once, and the guard that the
// stats summaries keep saying which way they are facing.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextOpenPanel, panelIsOpen, type OpenPanel } from './disclosure';

describe('one open at a time', () => {
  it('starts with everything shut', () => {
    const start: OpenPanel = null;
    for (const k of ['stats', 'places', 'parks', 'peaks']) {
      expect(panelIsOpen(start, k)).toBe(false);
    }
  });

  it('opens the panel that was activated', () => {
    expect(nextOpenPanel(null, 'stats')).toBe('stats');
    expect(panelIsOpen(nextOpenPanel(null, 'stats'), 'stats')).toBe(true);
  });

  it('CLOSES a panel when its own summary is activated again', () => {
    // The half of the bug that made the section a wall: something you open must
    // be something you can shut.
    expect(nextOpenPanel('stats', 'stats')).toBe(null);
  });

  it('shuts the previous panel when another is opened', () => {
    // "They don't disappear" — four independent <details> could all be open at once.
    // As a group, only ever one is.
    const afterStats = nextOpenPanel(null, 'stats');
    const afterPlaces = nextOpenPanel(afterStats, 'places');
    expect(afterPlaces).toBe('places');
    expect(panelIsOpen(afterPlaces, 'stats')).toBe(false);
    expect(panelIsOpen(afterPlaces, 'places')).toBe(true);
  });

  it('never reports two panels open, however they are clicked', () => {
    const keys = ['stats', 'places', 'parks', 'peaks'];
    let open: OpenPanel = null;
    // Every panel, twice round, in order and then reversed.
    for (const k of [...keys, ...keys, ...[...keys].reverse()]) {
      open = nextOpenPanel(open, k);
      expect(keys.filter((x) => panelIsOpen(open, x)).length).toBeLessThanOrEqual(1);
    }
  });

  it('leaves a group alone when a panel it does not contain is toggled', () => {
    // The per-state panels inside "Cities and states" are their own group; a click
    // in one must not read as a click in the other.
    expect(nextOpenPanel('stats', 'Virginia')).toBe('Virginia');
    expect(panelIsOpen('Virginia', 'stats')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The stylesheet guard. The bug was NOT a broken native toggle — that was checked
// in both engines and worked. It was a summary that looked the same open as shut.
// ---------------------------------------------------------------------------
describe('a stats summary says which way it is facing', () => {
  const sheet = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

  it('can read the stylesheet', () => {
    expect(sheet.length, 'app/src/index.css should be readable').toBeGreaterThan(1000);
  });

  it('hides the native marker only because it supplies its own', () => {
    // `.stats-dropdown > summary` sets `list-style: none` and kills the webkit marker.
    // That is fine — every disclosure in this app does — but ONLY if a replacement
    // arrow is drawn, and only if it changes on [open]. Without both, the control is
    // invisible and its state is unknowable, which is what Erica hit.
    expect(sheet).toMatch(/\.stats-dropdown\s*>\s*summary::before\s*\{[^}]*content:/);
    expect(sheet).toMatch(/\.stats-dropdown\[open\]\s*>\s*summary::before\s*\{[^}]*content:/);
  });

  it('uses a different glyph open than shut', () => {
    const shut = /\.stats-dropdown\s*>\s*summary::before\s*\{[^}]*content:\s*'([^']*)'/.exec(sheet);
    const open =
      /\.stats-dropdown\[open\]\s*>\s*summary::before\s*\{[^}]*content:\s*'([^']*)'/.exec(sheet);
    expect(shut?.[1], 'no closed-state glyph').toBeTruthy();
    expect(open?.[1], 'no open-state glyph').toBeTruthy();
    expect(shut?.[1]).not.toBe(open?.[1]);
  });
});
