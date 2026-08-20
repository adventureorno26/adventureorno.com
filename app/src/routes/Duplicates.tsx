import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  dismissDuplicate,
  dupeKey,
  fetchDismissedDupes,
  fetchPlaces,
  fetchPlaceVisitTotals,
  mergePlaces,
} from '../lib/data';
// THE RULE ITSELF IS NOT HERE ANY MORE. Needs attention counts these too, and a rule
// written twice is a count that eventually disagrees with the list it links to.
import { duplicatePairs, type DuplicatePair as Pair } from '../lib/duplicatePlaces';
import { showSnack } from '../lib/snackbar';
import type { Place } from '../lib/types';

/** Suspected duplicate places — pairs of saved places that sit within ~150 m of
 *  each other or share a name. Merge combines their photos + visit history into
 *  one (the more-visited one wins). */
export default function Duplicates() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  // WHICH PLACE SURVIVES IS DECIDED BY THIS. `places.visit_count` is a mirror that
  // nobody refreshes when a visit changes — merging two visits into one leaves it
  // where it was — so choosing the winner by it can hand the history to the wrong
  // place, and a merge is not undone by pressing it again. Counted fresh (0190).
  const [totals, setTotals] = useState<Map<string, number> | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
    fetchDismissedDupes()
      .then(setDismissed)
      .catch(() => undefined);
    fetchPlaceVisitTotals()
      .then(setTotals)
      .catch(() => setTotals(null));
  }
  useEffect(load, []);

  // Falls back to the stored count only while the totals are loading, so the screen
  // is never blank; the pairs recompute once they arrive.
  const visitsOf = useCallback(
    (p: Place) => totals?.get(p.id) ?? (totals ? 0 : (p.visit_count ?? 0)),
    [totals],
  );

  const pairs = useMemo<Pair[]>(
    () => duplicatePairs(places ?? [], dismissed, visitsOf),
    [places, dismissed, visitsOf],
  );

  async function keepSeparate(pair: Pair) {
    setBusy(pair.b.id);
    try {
      await dismissDuplicate(pair.a.id, pair.b.id);
      setDismissed((cur) => new Set(cur).add(dupeKey(pair.a.id, pair.b.id)));
      showSnack({ message: 'Kept separate — won’t suggest these again.' });
    } catch {
      showSnack({ message: 'Could not save that.' });
    }
    setBusy(null);
  }

  async function merge(pair: Pair) {
    setBusy(pair.b.id);
    try {
      await mergePlaces(pair.b.id, pair.a.id); // loser, winner
      setPlaces((cur) => (cur ? cur.filter((p) => p.id !== pair.b.id) : cur));
      showSnack({ message: `Merged into “${pair.a.name}”` });
    } catch {
      showSnack({ message: 'Could not merge those places.' });
    }
    setBusy(null);
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Duplicate places</h1>
      <p className="label" style={{ margin: '0 0 12px' }}>
        Places that sit almost on top of each other or share a name. Merging keeps all photos and
        visit history under one place — the more-visited one wins.
      </p>
      {places === null ? (
        <p className="label">Checking…</p>
      ) : pairs.length === 0 ? (
        <p className="label">No suspected duplicates. 🎉</p>
      ) : (
        <div className="dup-list">
          {pairs.map((pair) => (
            <div key={`${pair.a.id}-${pair.b.id}`} className="dup-row">
              <div className="dup-main">
                <div>
                  <Link to={`/place/${pair.a.id}`}>{pair.a.name || 'Untitled'}</Link>{' '}
                  <span className="label">(keep · {visitsOf(pair.a)} visits)</span>
                </div>
                <div>
                  <Link to={`/place/${pair.b.id}`}>{pair.b.name || 'Untitled'}</Link>{' '}
                  <span className="label">(merge in · {visitsOf(pair.b)} visits)</span>
                </div>
                <span className="label">
                  {pair.sameName ? 'same name · ' : ''}
                  {pair.meters} m apart
                </span>
              </div>
              <div className="dup-actions">
                <button
                  className="dup-btn"
                  disabled={busy === pair.b.id}
                  onClick={() => void merge(pair)}
                >
                  Merge
                </button>
                <button
                  className="dup-btn dup-keep"
                  disabled={busy === pair.b.id}
                  onClick={() => void keepSeparate(pair)}
                >
                  Keep separate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
