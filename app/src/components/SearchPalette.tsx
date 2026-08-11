import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAllEntries } from '../lib/data';
import { fetchSearchActivities, type SearchActivity } from '../lib/strava';
import { CATEGORIES, categoryLabel, effectiveCategories } from '../lib/categories';
import type { Place } from '../lib/types';

interface SearchItem {
  placeId: string;
  to: string; // where to navigate on select
  label: string; // primary line
  sub: string; // secondary line
  hay: string; // lower-cased searchable text
  kind: 'place' | 'spot' | 'activity';
  cats: string[]; // category slugs, for the type filter
}

// Strava activity type → the map category slug (so the type chips filter them).
const ACT_CAT: Record<string, string> = {
  Run: 'running',
  Hike: 'hiking',
  Walk: 'walking',
  Ride: 'biking',
};

/** ⌘K / Ctrl-K global search over the places YOU'VE added — names, regions,
 *  reviews, tags, and spots. Type to filter; Enter/click opens the place. */
export default function SearchPalette({ places }: { places: Place[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<
    { id: string; place_id: string; title: string; body: string | null; kind: string }[]
  >([]);
  const [activities, setActivities] = useState<SearchActivity[]>([]);
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
    setActiveCats(new Set());
    fetchAllEntries()
      .then(setEntries)
      .catch(() => setEntries([]));
    fetchSearchActivities()
      .then(setActivities)
      .catch(() => setActivities([]));
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
        to: `/place/${p.id}`,
        label: p.name,
        sub: [region, p.bucket ? 'Bucket list' : '', p.is_trail ? 'Trail' : '']
          .filter(Boolean)
          .join(' · '),
        hay: `${p.name} ${region} ${p.address ?? ''} ${p.review ?? ''} ${tags}`.toLowerCase(),
        kind: 'place',
        cats: effectiveCategories(p),
      });
    }
    for (const e of entries) {
      const p = placeName.get(e.place_id);
      if (!p || p.bucket) continue;
      out.push({
        placeId: e.place_id,
        to: `/place/${e.place_id}`,
        label: e.title,
        sub: `${p.name}${e.kind ? ` · ${categoryLabel(e.kind)}` : ''}`,
        hay: `${e.title} ${e.body ?? ''} ${p.name}`.toLowerCase(),
        kind: 'spot',
        cats: e.kind ? [e.kind] : [],
      });
    }
    for (const a of activities) {
      const day = a.local_date ?? (a.start_date ?? '').slice(0, 10);
      const label = a.name || `${a.type}${a.place_name ? ` · ${a.place_name}` : ''}`;
      out.push({
        placeId: a.place_id ?? '',
        to: a.place_id ? `/place/${a.place_id}${day ? `/day/${day}` : ''}` : '#',
        label,
        sub: [a.type, a.place_name ?? '', day].filter(Boolean).join(' · '),
        hay: `${a.name ?? ''} ${a.type} ${a.place_name ?? ''}`.toLowerCase(),
        kind: 'activity',
        cats: ACT_CAT[a.type] ? [ACT_CAT[a.type]] : [],
      });
    }
    return out;
  }, [places, entries, activities, placeName]);

  // Category filter chips — only the categories that actually appear in the data,
  // in CATEGORIES order. Selecting some narrows results to items with those tags.
  const [activeCats, setActiveCats] = useState<Set<string>>(new Set());
  const availableCats = useMemo(() => {
    const present = new Set<string>();
    for (const it of items) for (const c of it.cats) present.add(c);
    return CATEGORIES.filter((c) => present.has(c.slug)).map((c) => c.slug);
  }, [items]);
  const toggleCat = (slug: string) =>
    setActiveCats((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const results = useMemo(() => {
    const catOk = (it: SearchItem) =>
      activeCats.size === 0 || it.cats.some((c) => activeCats.has(c));
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0)
      return (
        items
          // With a category filter on, show every matching item (places + spots);
          // with no filter and no query, just the places.
          .filter((i) => (activeCats.size ? true : i.kind === 'place') && catOk(i))
          .sort((a, b) => a.label.localeCompare(b.label))
          .slice(0, activeCats.size ? 80 : 30)
      );
    const scored: { item: SearchItem; score: number }[] = [];
    for (const item of items) {
      if (!catOk(item)) continue;
      let score = 0;
      for (const t of tokens) {
        if (!item.hay.includes(t)) {
          score = -1;
          break;
        }
        // Boost when the token hits the start of the label.
        score += item.label.toLowerCase().startsWith(t)
          ? 3
          : item.label.toLowerCase().includes(t)
            ? 2
            : 1;
      }
      if (score >= 0) scored.push({ item, score });
    }
    // Highest score first; alphabetical within the same score.
    scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
    return scored.slice(0, 40).map((s) => s.item);
  }, [q, items, activeCats]);

  function choose(item: SearchItem) {
    if (item.to === '#') return;
    setOpen(false);
    navigate(item.to);
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
              placeholder="Search your places, notes, reviews, tags…"
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
            {availableCats.length > 0 && (
              <div className="search-cat-filter">
                {availableCats.map((slug) => (
                  <button
                    key={slug}
                    className={`search-cat-chip ${activeCats.has(slug) ? 'on' : ''}`}
                    onClick={() => {
                      toggleCat(slug);
                      setActive(0);
                    }}
                  >
                    {categoryLabel(slug)}
                  </button>
                ))}
              </div>
            )}
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
