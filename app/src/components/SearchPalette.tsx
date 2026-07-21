import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAllEntries } from '../lib/data';
import { categoryLabel } from '../lib/categories';
import type { Place } from '../lib/types';

interface SearchItem {
  placeId: string;
  label: string; // primary line
  sub: string; // secondary line
  hay: string; // lower-cased searchable text
  kind: 'place' | 'spot';
}

/** ⌘K / Ctrl-K global search over the places YOU'VE added — names, regions,
 *  reviews, tags, and spots. Type to filter; Enter/click opens the place. */
export default function SearchPalette({ places }: { places: Place[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<
    { id: string; place_id: string; title: string; body: string | null; kind: string }[]
  >([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  // Open on ⌘K / Ctrl-K anywhere; close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load spots the first time the palette opens; focus the input.
  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    fetchAllEntries().then(setEntries).catch(() => setEntries([]));
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const placeName = useMemo(() => {
    const m = new Map<string, Place>();
    for (const p of places) m.set(p.id, p);
    return m;
  }, [places]);

  const items: SearchItem[] = useMemo(() => {
    const out: SearchItem[] = [];
    for (const p of places) {
      if (p.bucket) continue; // only things we've actually done, not the wishlist
      const region = [p.admin1, p.country].filter(Boolean).join(', ');
      const tags = (p.categories ?? []).map((c) => categoryLabel(c)).join(' ');
      out.push({
        placeId: p.id,
        label: p.name,
        sub: [region, p.bucket ? 'Bucket list' : '', p.is_trail ? 'Trail' : '']
          .filter(Boolean)
          .join(' · '),
        hay: `${p.name} ${region} ${p.address ?? ''} ${p.review ?? ''} ${tags}`.toLowerCase(),
        kind: 'place',
      });
    }
    for (const e of entries) {
      const p = placeName.get(e.place_id);
      if (!p || p.bucket) continue;
      out.push({
        placeId: e.place_id,
        label: e.title,
        sub: `${p.name}${e.kind ? ` · ${categoryLabel(e.kind)}` : ''}`,
        hay: `${e.title} ${e.body ?? ''} ${p.name}`.toLowerCase(),
        kind: 'spot',
      });
    }
    return out;
  }, [places, entries, placeName]);

  const results = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return items.filter((i) => i.kind === 'place').slice(0, 30);
    const scored: { item: SearchItem; score: number }[] = [];
    for (const item of items) {
      let score = 0;
      for (const t of tokens) {
        if (!item.hay.includes(t)) {
          score = -1;
          break;
        }
        // Boost when the token hits the start of the label.
        score += item.label.toLowerCase().startsWith(t) ? 3 : item.label.toLowerCase().includes(t) ? 2 : 1;
      }
      if (score >= 0) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 40).map((s) => s.item);
  }, [q, items]);

  function choose(item: SearchItem) {
    setOpen(false);
    navigate(`/place/${item.placeId}`);
  }

  return (
    <>
      <button
        className="places-search-btn"
        onClick={() => setOpen(true)}
        title="Search your activities (⌘K)"
      >
        Search your activities
      </button>

      {open && (
        <div className="search-palette-backdrop" onClick={() => setOpen(false)}>
          <div className="search-palette" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              className="search-palette-input"
              value={q}
              placeholder="Search your places, spots, reviews, tags…"
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter' && results[active]) {
                  choose(results[active]);
                }
              }}
            />
            <div className="search-palette-list">
              {results.length === 0 ? (
                <div className="search-palette-empty">No matches</div>
              ) : (
                results.map((item, i) => (
                  <button
                    key={`${item.kind}-${item.placeId}-${i}`}
                    className={`search-palette-row ${i === active ? 'active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                  >
                    <span className="sp-label">{item.label}</span>
                    <span className="sp-sub">{item.sub}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
