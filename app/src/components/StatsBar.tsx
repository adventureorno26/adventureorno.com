import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MileageRow, Place } from '../lib/types';
import { fetchMileage } from '../lib/strava';
import { fetchAllEntries } from '../lib/data';

interface Props {
  places: Place[];
  onFilterCategory: (slug: string | null) => void;
  // "Just me / Just Josh" filter: scope the stats to that person.
  personFilter?: string | null;
}

// Strava activity type → map filter category.
const STRAVA_CAT: Record<string, string> = {
  Run: 'running',
  Hike: 'hiking',
  Walk: 'walking',
  Ride: 'biking',
};

// Human noun for an activity count, e.g. Run → "runs", Ride → "rides".
const ACTIVITY_NOUN: Record<string, string> = {
  Run: 'run',
  Hike: 'hike',
  Walk: 'walk',
  Ride: 'ride',
};
function activityNoun(type: string, n: number): string {
  const base = ACTIVITY_NOUN[type] ?? 'activity';
  if (n === 1) return base;
  return base === 'activity' ? 'activities' : `${base}s`;
}

/** Count up to `target` over ~700ms with requestAnimationFrame. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const from = 0;
    const dur = 700;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    startRef.current = null;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

export default function StatsBar({ places, onFilterCategory, personFilter = null }: Props) {
  // Only saved, non-bucket places count. "Just me / Just Josh" hides only places
  // explicitly marked the other person's; "both"-tagged places count for either.
  const visited = places.filter(
    (p) =>
      !p.bucket &&
      p.saved &&
      p.name.trim() !== '' && // skip unnamed drafts
      !(personFilter && p.solo_profile && p.solo_profile !== personFilter),
  );
  // Main bar shows just Places + Miles. Cities/States moved to Settings.
  const [detail, setDetail] = useState<null | 'places' | 'miles'>(null);
  const placeList = [...visited].sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (k: typeof detail) => setDetail((cur) => (cur === k ? null : k));
  const closeDetail = () => setDetail(null);

  // Trails + Spots + Places all count. Trails/places are already in `visited`;
  // spots (entries) add to the total AND the drill-down list. Visits are NOT
  // counted (they're repeat trips to a place already counted).
  const [spots, setSpots] = useState<{ id: string; place_id: string; title: string }[]>([]);
  useEffect(() => {
    fetchAllEntries()
      .then((rows) =>
        setSpots(rows.map((r) => ({ id: r.id, place_id: r.place_id, title: r.title }))),
      )
      .catch(() => setSpots([]));
  }, [places.length]);
  const placesTotal = visited.length + spots.length;

  // Combined drill-down: every place AND every spot, alphabetical.
  const placeName = (id: string) => places.find((p) => p.id === id)?.name ?? '';
  const combinedList = [
    ...placeList.map((p) => ({
      id: p.id,
      label: p.name,
      sub: p.admin1 ?? '',
      to: `/place/${p.id}`,
    })),
    ...spots.map((s) => ({
      id: s.id,
      label: s.title,
      sub: placeName(s.place_id),
      to: `/place/${s.place_id}`,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const [mileage, setMileage] = useState<MileageRow[]>([]);
  useEffect(() => {
    fetchMileage(personFilter)
      .then(setMileage)
      .catch(() => setMileage([]));
  }, [places.length, personFilter]); // refresh on data change or person toggle

  const totalMiles = mileage.reduce((sum, r) => sum + Number(r.miles), 0);
  const animated = useCountUp(totalMiles);

  return (
    <div className="stats-bar">
      <div className="stat-row">
        <button
          className={`stat ${detail === 'places' ? 'on' : ''}`}
          onClick={() => toggle('places')}
        >
          <b>{placesTotal}</b> <span className="label">places</span>
        </button>
        <button
          className={`stat ${detail === 'miles' ? 'on' : ''}`}
          onClick={() => toggle('miles')}
        >
          <b>{animated.toFixed(1)}</b> <span className="label">miles</span>
        </button>
      </div>

      {detail && (
        <div className="stat-detail">
          <div className="stat-detail-head">
            <b>{detail === 'places' ? 'All places' : 'Activity totals — tap to show on map'}</b>
            <button className="stat-detail-x" onClick={closeDetail}>
              ×
            </button>
          </div>
          <div className="stat-detail-list">
            {detail === 'places' &&
              combinedList.map((it) => (
                <Link key={it.id} to={it.to} onClick={closeDetail}>
                  {it.label || 'Untitled'}
                  {it.sub ? <span className="label"> · {it.sub}</span> : null}
                </Link>
              ))}
            {detail === 'miles' &&
              (mileage.filter((r) => Number(r.miles) > 0).length === 0 ? (
                <span className="label">No Strava activities yet</span>
              ) : (
                [...mileage]
                  .filter((r) => Number(r.miles) > 0)
                  .sort((a, b) => Number(b.miles) - Number(a.miles))
                  .map((r) => {
                    const cat = STRAVA_CAT[r.type];
                    const n = Number(r.activity_count);
                    const row = (
                      <>
                        <span className="mi-count">
                          {n} {activityNoun(r.type, n)}
                        </span>
                        <span className="mi-val">
                          <b>{Number(r.miles).toFixed(1)}</b>
                          <span className="mi-unit">mi</span>
                        </span>
                        {cat && <span className="stat-chev">›</span>}
                      </>
                    );
                    return cat ? (
                      <button
                        key={r.type}
                        className="mi-row"
                        onClick={() => {
                          onFilterCategory(cat);
                          closeDetail();
                        }}
                      >
                        {row}
                      </button>
                    ) : (
                      <span key={r.type} className="mi-row">
                        {row}
                      </span>
                    );
                  })
              ))}
          </div>
        </div>
      )}

      <div className="spacer" />

      <div className="actions">
        <Link to="/settings">
          <button className="gear-btn" aria-label="Settings" title="Settings">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Link>
      </div>
    </div>
  );
}
