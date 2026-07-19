import { useEffect, useRef, useState } from 'react';
import { searchGeocode, type SearchResult } from '../lib/maptiler';

/** Search box on the map: type a location → suggestions → pick to add a card.
 *  getProximity biases results toward the current map view for accuracy. */
export default function MapSearch({
  onPick,
  getProximity,
}: {
  onPick: (r: SearchResult) => void;
  getProximity?: () => [number, number] | undefined;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setResults(await searchGeocode(q, getProximity?.()));
      setOpen(true);
    }, 280);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function choose(r: SearchResult) {
    onPick(r);
    setQ('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="map-search">
      <div className="map-search-box">
        <span className="map-search-ico">🔎</span>
        <input
          value={q}
          placeholder="Search a place to add…"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) choose(results[0]);
            if (e.key === 'Escape') {
              setQ('');
              setOpen(false);
            }
          }}
        />
        {q && (
          <button
            className="map-search-x"
            aria-label="Clear"
            onClick={() => {
              setQ('');
              setResults([]);
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="map-search-list">
          {results.map((r) => (
            <button key={r.id} onClick={() => choose(r)}>
              📍 {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
