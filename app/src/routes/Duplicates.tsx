import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  dismissDuplicate,
  dupeKey,
  fetchDismissedDupes,
  fetchPlaces,
  mergePlaces,
} from '../lib/data';
import { haversineMeters } from '../lib/geo';
import { showSnack } from '../lib/snackbar';
import type { Place } from '../lib/types';

interface Pair {
  a: Place; // winner (keeps history) — the more-established of the two
  b: Place; // loser (merged in)
  meters: number;
  sameName: boolean;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Suspected duplicate places — pairs of saved places that sit within ~150 m of
 *  each other or share a name. Merge combines their photos + visit history into
 *  one (the more-visited one wins). */
export default function Duplicates() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetchPlaces()
      .then((r) =>
        setPlaces(r.filter((p) => p.saved && !p.bucket && !p.holds_children && !p.is_trail)),
      )
      .catch(() => setPlaces([]));
    fetchDismissedDupes()
      .then(setDismissed)
      .catch(() => undefined);
  }
  useEffect(load, []);

  const pairs = useMemo<Pair[]>(() => {
    const ps = places ?? [];
    const out: Pair[] = [];
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const p = ps[i];
        const q = ps[j];
        if (dismissed.has(dupeKey(p.id, q.id))) continue; // kept separate — hide it
        const m = haversineMeters({ lat: p.lat, lng: p.lng }, { lat: q.lat, lng: q.lng });
        const sameName = !!p.name && norm(p.name) === norm(q.name);
        if (m <= 150 || (sameName && m <= 3000)) {
          // Winner = more visits (keeps the richer history).
          const [a, b] = (p.visit_count ?? 0) >= (q.visit_count ?? 0) ? [p, q] : [q, p];
          out.push({ a, b, meters: Math.round(m), sameName });
        }
      }
    }
    return out.sort((x, y) => x.meters - y.meters);
  }, [places, dismissed]);

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
                  <span className="label">(keep · {pair.a.visit_count ?? 0} visits)</span>
                </div>
                <div>
                  <Link to={`/place/${pair.b.id}`}>{pair.b.name || 'Untitled'}</Link>{' '}
                  <span className="label">(merge in · {pair.b.visit_count ?? 0} visits)</span>
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
