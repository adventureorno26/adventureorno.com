import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MileageRow, Place } from '../lib/types';
import { fetchMileage } from '../lib/strava';

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

function uniqueCount(values: (string | null)[]): number {
  return new Set(values.filter((v): v is string => !!v && v.trim() !== '')).size;
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
      !(personFilter && p.solo_profile && p.solo_profile !== personFilter),
  );
  const countries = uniqueCount(visited.map((p) => p.country));
  const states = uniqueCount(visited.map((p) => p.admin1));
  const [detail, setDetail] = useState<null | 'places' | 'countries' | 'states' | 'miles'>(null);
  // Drill-down: a country or state selected → shows its cities/places.
  const [sub, setSub] = useState<{ kind: 'country' | 'state'; value: string } | null>(null);

  const placeList = [...visited].sort((a, b) => a.name.localeCompare(b.name));
  const countryList = [...new Set(visited.map((p) => p.country).filter(Boolean))].sort() as string[];
  const stateList = [...new Set(visited.map((p) => p.admin1).filter(Boolean))].sort() as string[];
  const toggle = (k: typeof detail) => {
    setSub(null);
    setDetail((cur) => (cur === k ? null : k));
  };
  const closeDetail = () => {
    setSub(null);
    setDetail(null);
  };
  // Places within the drilled-in country/state, alphabetical.
  const subPlaces = sub
    ? placeList.filter((p) => (sub.kind === 'country' ? p.country : p.admin1) === sub.value)
    : [];

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
        <button className={`stat ${detail === 'places' ? 'on' : ''}`} onClick={() => toggle('places')}>
          <b>{visited.length}</b> <span className="label">places</span>
        </button>
        <button
          className={`stat ${detail === 'countries' ? 'on' : ''}`}
          onClick={() => toggle('countries')}
        >
          <b>{countries}</b> <span className="label">countries</span>
        </button>
        <button className={`stat ${detail === 'states' ? 'on' : ''}`} onClick={() => toggle('states')}>
          <b>{states}</b> <span className="label">states</span>
        </button>
        <button className={`stat ${detail === 'miles' ? 'on' : ''}`} onClick={() => toggle('miles')}>
          <b>{animated.toFixed(1)}</b> <span className="label">miles</span>
        </button>
      </div>

      {detail && (
        <div className="stat-detail">
          <div className="stat-detail-head">
            <b>
              {sub ? (
                <button className="stat-back" onClick={() => setSub(null)}>
                  ‹ {sub.value}
                </button>
              ) : detail === 'places' ? (
                'All places'
              ) : detail === 'countries' ? (
                'Countries — tap for cities'
              ) : detail === 'states' ? (
                'States / regions — tap for cities'
              ) : (
                'Activity totals — tap to show on map'
              )}
            </b>
            <button className="stat-detail-x" onClick={closeDetail}>
              ×
            </button>
          </div>
          <div className="stat-detail-list">
            {detail === 'places' &&
              placeList.map((p) => (
                <Link key={p.id} to={`/place/${p.id}`} onClick={closeDetail}>
                  {p.name}
                  {p.admin1 ? <span className="label"> · {p.admin1}</span> : null}
                </Link>
              ))}
            {/* country/state → drill into their cities (places), then to the card */}
            {(detail === 'countries' || detail === 'states') &&
              (sub ? (
                subPlaces.map((p) => (
                  <Link key={p.id} to={`/place/${p.id}`} onClick={closeDetail}>
                    {p.name}
                  </Link>
                ))
              ) : (detail === 'countries' ? countryList : stateList).map((v) => (
                <button
                  key={v}
                  onClick={() =>
                    setSub({ kind: detail === 'countries' ? 'country' : 'state', value: v })
                  }
                >
                  {v} <span className="stat-chev">›</span>
                </button>
              )))}
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
            ⚙
          </button>
        </Link>
      </div>
    </div>
  );
}
