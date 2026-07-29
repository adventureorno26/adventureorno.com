import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPlaces } from '../lib/data';
import { fetchMileage } from '../lib/strava';
import { categoryLabel } from '../lib/categories';
import type { MileageRow, Place } from '../lib/types';

// "Our Year in Travel" — a shareable recap of the couple's adventures, filtered
// to a year. Everything is computed from the data already in the app.
function yearOf(p: Place): number | null {
  const d = p.first_visit ?? p.last_visit;
  return d ? Number(d.slice(0, 4)) : null;
}

export default function Wrapped() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [mileage, setMileage] = useState<MileageRow[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    fetchPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]));
    fetchMileage()
      .then(setMileage)
      .catch(() => setMileage([]));
  }, []);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const p of places ?? []) {
      const y = yearOf(p);
      if (y) set.add(y);
    }
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [places]);

  const stats = useMemo(() => {
    const saved = (places ?? []).filter((p) => p.saved && !p.bucket && p.name.trim());
    const inYear = saved.filter((p) => yearOf(p) === year);
    const isUS = (p: Place) => (p.country ?? '').match(/^(United States|USA|US)$/i);
    const states = new Set(
      inYear
        .filter(isUS)
        .map((p) => p.admin1)
        .filter(Boolean),
    );
    const countries = new Set(inYear.map((p) => p.country).filter(Boolean));
    const trips = inYear.filter((p) => (p.categories ?? []).includes('trip') && !p.suggested);
    const parks = inYear.filter((p) =>
      /national (park|monument|forest|seashore|recreation area|historic)/i.test(p.name),
    );
    // Top categories (excluding container/utility tags).
    const skip = new Set(['trip', 'trail', 'note']);
    const tagCounts = new Map<string, number>();
    for (const p of inYear)
      for (const c of p.categories ?? [])
        if (!skip.has(c)) tagCounts.set(c, (tagCounts.get(c) ?? 0) + 1);
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const miles = mileage.reduce((s, r) => s + Number(r.miles), 0);
    // Farthest place from home (Leesburg) — the biggest adventure.
    const home = { lat: 39.1157, lng: -77.5636 };
    let farthest: { name: string; mi: number } | null = null;
    for (const p of inYear) {
      const dLat = ((p.lat - home.lat) * Math.PI) / 180;
      const dLng = ((p.lng - home.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((home.lat * Math.PI) / 180) *
          Math.cos((p.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const mi = 3958.8 * 2 * Math.asin(Math.sqrt(a));
      if (!farthest || mi > farthest.mi) farthest = { name: p.name, mi };
    }
    return { count: inYear.length, states, countries, trips, parks, topTags, miles, farthest };
  }, [places, mileage, year]);

  if (!places) return <div className="center-screen">Loading…</div>;

  return (
    <div className="wrapped">
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>

      <div className="wrapped-hero">
        <div className="wrapped-year-row">
          {years.map((y) => (
            <button
              key={y}
              className={`wrapped-year ${y === year ? 'on' : ''}`}
              onClick={() => setYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
        <h1>Our Year in Travel</h1>
        <p className="wrapped-sub">{year} · Erica &amp; Josh</p>
      </div>

      <div className="wrapped-grid">
        <div className="wrapped-stat big">
          <b>{stats.count}</b>
          <span>places</span>
        </div>
        <div className="wrapped-stat">
          <b>{stats.states.size}</b>
          <span>states</span>
        </div>
        <div className="wrapped-stat">
          <b>{stats.countries.size}</b>
          <span>countries</span>
        </div>
        <div className="wrapped-stat">
          <b>{stats.trips.length}</b>
          <span>trips</span>
        </div>
        <div className="wrapped-stat">
          <b>{stats.miles.toFixed(0)}</b>
          <span>miles moved</span>
        </div>
        <div className="wrapped-stat">
          <b>{stats.parks.length}</b>
          <span>national parks</span>
        </div>
      </div>

      {stats.farthest && stats.farthest.mi > 40 && (
        <div className="wrapped-card">
          <div className="wrapped-card-label">Biggest adventure</div>
          <div className="wrapped-card-value">{stats.farthest.name}</div>
          <div className="wrapped-card-sub">{stats.farthest.mi.toFixed(0)} miles from home</div>
        </div>
      )}

      {stats.topTags.length > 0 && (
        <div className="wrapped-card">
          <div className="wrapped-card-label">What we loved</div>
          <div className="wrapped-tags">
            {stats.topTags.map(([slug, n]) => (
              <span key={slug} className="wrapped-tag">
                {categoryLabel(slug)} <b>{n}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {stats.trips.length > 0 && (
        <div className="wrapped-card">
          <div className="wrapped-card-label">Our trips</div>
          <div className="wrapped-trips">
            {stats.trips
              .sort((a, b) => (b.first_visit ?? '').localeCompare(a.first_visit ?? ''))
              .map((t) => (
                <Link key={t.id} to={`/place/${t.id}`} className="wrapped-trip">
                  {t.name}
                </Link>
              ))}
          </div>
        </div>
      )}

      {stats.count === 0 && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 20 }}>
          No adventures logged in {year} yet.
        </p>
      )}
    </div>
  );
}
