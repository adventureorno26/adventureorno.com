import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import type { MileageRow, Place } from '../lib/types';
import { fetchMileage } from '../lib/strava';

interface Props {
  places: Place[];
  addMode: boolean;
  onToggleAdd: () => void;
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

export default function StatsBar({ places, addMode, onToggleAdd }: Props) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const countries = uniqueCount(places.map((p) => p.country));
  const states = uniqueCount(places.map((p) => p.admin1));

  const [mileage, setMileage] = useState<MileageRow[]>([]);
  useEffect(() => {
    fetchMileage()
      .then(setMileage)
      .catch(() => setMileage([]));
  }, [places.length]); // refresh when data likely changed

  const totalMiles = mileage.reduce((sum, r) => sum + Number(r.miles), 0);
  const animated = useCountUp(totalMiles);
  const breakdown = [...mileage]
    .filter((r) => Number(r.miles) > 0)
    .sort((a, b) => Number(b.miles) - Number(a.miles))
    .map((r) => `${r.type} ${Number(r.miles).toFixed(1)}`)
    .join(' · ');

  return (
    <div className="stats-bar">
      <div className="stat-hero">
        <div className="stat">
          <span className="stat-ico">📍</span>
          <b>{places.length}</b> <span className="label">places</span>
        </div>
        <div className="stat">
          <span className="stat-ico">🌍</span>
          <b>{countries}</b> <span className="label">countries</span>
        </div>
        <div className="stat hide-sm">
          <span className="stat-ico">🗺️</span>
          <b>{states}</b> <span className="label">states</span>
        </div>
        <div className="stat" title={breakdown || 'No Strava activities yet'}>
          <span className="stat-ico">🥾</span>
          <b>{animated.toFixed(1)}</b> <span className="label">mi</span>
        </div>
      </div>

      <div className="spacer" />

      <div className="actions">
        {canEdit && (
          <button className={addMode ? 'primary' : ''} onClick={onToggleAdd} title="Add a place">
            {addMode ? 'Click map…' : '+ Add'}
          </button>
        )}
        <Link to="/places" title="All places">
          <button aria-label="Places">📋</button>
        </Link>
        <Link to="/trips" title="Trips">
          <button aria-label="Trips">🧳</button>
        </Link>
        <Link to="/settings" title="Settings">
          <button aria-label="Settings">⚙︎</button>
        </Link>
      </div>
    </div>
  );
}
