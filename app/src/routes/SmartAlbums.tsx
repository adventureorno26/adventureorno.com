import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPlaces } from '../lib/data';
import { effectiveCategories } from '../lib/categories';
import type { Place } from '../lib/types';

interface Album {
  key: string;
  title: string;
  hint: string;
  match: (p: Place) => boolean;
}

const THIS_YEAR = new Date().getFullYear();

const ALBUMS: Album[] = [
  {
    key: 'parks',
    title: 'National parks & public lands',
    hint: 'Places inside a park boundary',
    match: (p) => !!p.park,
  },
  {
    key: 'beach',
    title: 'Beaches',
    hint: 'Tagged beach',
    match: (p) => effectiveCategories(p).includes('beach'),
  },
  {
    key: 'goldenhour',
    title: 'Sunrises & sunsets',
    hint: 'Tagged sunrise or sunset',
    match: (p) => {
      const c = effectiveCategories(p);
      return c.includes('sunset') || c.includes('sunrise');
    },
  },
  {
    key: 'sips',
    title: 'Wineries & breweries',
    hint: 'Tasting stops',
    match: (p) => {
      const c = effectiveCategories(p);
      return c.includes('winery') || c.includes('brewery');
    },
  },
  {
    key: 'trails',
    title: 'Trails',
    hint: 'Linear routes with logged runs/hikes',
    match: (p) => p.is_trail,
  },
  {
    key: 'repeat',
    title: 'Repeat visits',
    hint: 'Places we’ve been more than once',
    match: (p) => (p.visit_count ?? 0) > 1,
  },
  {
    key: 'new',
    title: `New places this year (${THIS_YEAR})`,
    hint: 'First visited this year',
    match: (p) => (p.first_visit ?? '').slice(0, 4) === String(THIS_YEAR),
  },
  {
    key: 'favorites',
    title: 'Favorites',
    hint: 'Rated 4 stars or more',
    match: (p) => (p.rating ?? 0) >= 4,
  },
  {
    key: 'needsreview',
    title: 'Need a review',
    hint: 'Saved places with no review written yet',
    match: (p) => !p.holds_children && !p.is_trail && !(p.review && p.review.trim()),
  },
];

/** Rule-based smart albums — no manual curation, just live filters over your
 *  places. Each expands to the matching places. */
export default function SmartAlbums() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchPlaces()
      .then((r) => setPlaces(r.filter((p) => p.saved && !p.bucket)))
      .catch(() => setPlaces([]));
  }, []);

  const albums = useMemo(
    () =>
      (places ?? []).length
        ? ALBUMS.map((a) => ({
            ...a,
            places: (places ?? []).filter(a.match).sort((x, y) => x.name.localeCompare(y.name)),
          })).filter((a) => a.places.length > 0)
        : [],
    [places],
  );

  return (
    <div style={{ maxWidth: 720, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Smart albums</h1>
      {places === null ? (
        <p className="label">Loading…</p>
      ) : albums.length === 0 ? (
        <p className="label">No albums yet — add tags, ratings, and visits to your places.</p>
      ) : (
        <div className="album-list">
          {albums.map((a) => (
            <div key={a.key} className="album">
              <button className="album-head" onClick={() => setOpen(open === a.key ? null : a.key)}>
                <div>
                  <b>{a.title}</b> <span className="label">· {a.places.length}</span>
                  <div className="label">{a.hint}</div>
                </div>
                <span>{open === a.key ? '▾' : '▸'}</span>
              </button>
              {open === a.key && (
                <div className="visit-list" style={{ marginTop: 6 }}>
                  {a.places.map((p) => (
                    <div key={p.id} className="visit-row">
                      <Link className="visit-main" to={`/place/${p.id}`}>
                        {p.name}
                        {p.admin1 ? <span className="label"> · {p.admin1}</span> : null}
                      </Link>
                      {a.key === 'repeat' && (
                        <Link className="label" to={`/place/${p.id}/compare`}>
                          compare
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
