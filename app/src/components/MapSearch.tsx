import { useEffect, useRef, useState } from 'react';
import { retrieveResult, searchGeocode, type SearchResult } from '../lib/maptiler';
import { PinIcon, SearchIcon } from './Icons';

/** Search box on the map: type a location → suggestions → pick to add a card.
 *  getProximity biases results toward the current map view for accuracy. */
export default function MapSearch({
  onPick,
  getProximity,
  placeholder = 'Search a place to add…',
}: {
  onPick: (r: SearchResult) => void;
  getProximity?: () => [number, number] | undefined;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0); // request identity so a slow older query can't clobber newer results

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      const mySeq = ++seq.current;
      const r = await searchGeocode(q, getProximity?.());
      if (mySeq !== seq.current) return; // a newer query started — discard stale results
      setResults(r);
      setOpen(true);
    }, 280);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function choose(r: SearchResult) {
    setQ('');
    setResults([]);
    setOpen(false);
    // Search Box suggestions have no coords until retrieved.
    const full = r.mapbox_id ? await retrieveResult(r).catch(() => r) : r;
    if (full.lat === 0 && full.lng === 0) return; // couldn't resolve
    onPick(full);
  }

  return (
    <div className="map-search">
      <div className="map-search-box">
        <span className="map-search-ico">
          <SearchIcon size={16} />
        </span>
        <input
          value={q}
          placeholder={placeholder}
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
              <span className="result-pin">
                <PinIcon size={14} />
              </span>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
