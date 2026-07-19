import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import type { MileageRow, Place } from '../lib/types';
import { fetchMileage } from '../lib/strava';

interface Props {
  places: Place[];
  addMode: boolean;
  onToggleAdd: () => void;
  onAddPhotos: (files: FileList) => void;
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

export default function StatsBar({ places, addMode, onToggleAdd, onAddPhotos }: Props) {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  const countries = uniqueCount(places.map((p) => p.country));
  const states = uniqueCount(places.map((p) => p.admin1));
  const [addMenu, setAddMenu] = useState(false);
  const [detail, setDetail] = useState<null | 'places' | 'countries' | 'states' | 'miles'>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const placeList = [...places].sort((a, b) => a.name.localeCompare(b.name));
  const countryList = [...new Set(places.map((p) => p.country).filter(Boolean))].sort() as string[];
  const stateList = [...new Set(places.map((p) => p.admin1).filter(Boolean))].sort() as string[];
  const toggle = (k: typeof detail) => setDetail((cur) => (cur === k ? null : k));

  const [mileage, setMileage] = useState<MileageRow[]>([]);
  useEffect(() => {
    fetchMileage()
      .then(setMileage)
      .catch(() => setMileage([]));
  }, [places.length]); // refresh when data likely changed

  const totalMiles = mileage.reduce((sum, r) => sum + Number(r.miles), 0);
  const animated = useCountUp(totalMiles);

  return (
    <div className="stats-bar">
      <div className="stat-row">
        <button className={`stat ${detail === 'places' ? 'on' : ''}`} onClick={() => toggle('places')}>
          <b>{places.length}</b> <span className="label">places</span>
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
              {detail === 'places'
                ? 'All places'
                : detail === 'countries'
                  ? 'Countries'
                  : detail === 'states'
                    ? 'States / regions'
                    : 'Miles by activity'}
            </b>
            <button className="stat-detail-x" onClick={() => setDetail(null)}>
              ×
            </button>
          </div>
          <div className="stat-detail-list">
            {detail === 'places' &&
              placeList.map((p) => (
                <Link key={p.id} to={`/place/${p.id}`} onClick={() => setDetail(null)}>
                  {p.name}
                  {p.admin1 ? <span className="label"> · {p.admin1}</span> : null}
                </Link>
              ))}
            {detail === 'countries' && countryList.map((c) => <span key={c}>{c}</span>)}
            {detail === 'states' && stateList.map((s) => <span key={s}>{s}</span>)}
            {detail === 'miles' &&
              (mileage.filter((r) => Number(r.miles) > 0).length === 0 ? (
                <span className="label">No Strava activities yet</span>
              ) : (
                [...mileage]
                  .filter((r) => Number(r.miles) > 0)
                  .sort((a, b) => Number(b.miles) - Number(a.miles))
                  .map((r) => (
                    <span key={r.type}>
                      <b>{Number(r.miles).toFixed(1)}</b> <span className="label">mi</span> · {r.type}
                    </span>
                  ))
              ))}
          </div>
        </div>
      )}

      <div className="spacer" />

      <div className="actions">
        {canEdit &&
          (addMode ? (
            <button className="primary" onClick={onToggleAdd}>
              Click map to place…
            </button>
          ) : (
            <div className="add-wrap">
              <button onClick={() => setAddMenu((v) => !v)}>+ Add</button>
              {addMenu && (
                <div className="add-menu">
                  <button
                    onClick={() => {
                      setAddMenu(false);
                      onToggleAdd();
                    }}
                  >
                    📍 Place
                  </button>
                  <button
                    onClick={() => {
                      setAddMenu(false);
                      fileRef.current?.click();
                    }}
                  >
                    📷 Photo
                  </button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/heic,image/heif"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files && e.target.files.length) onAddPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          ))}
        <Link to="/trips">
          <button>Trips</button>
        </Link>
        <Link to="/settings">
          <button className="gear-btn" aria-label="Settings" title="Settings">
            ⚙
          </button>
        </Link>
      </div>
    </div>
  );
}
