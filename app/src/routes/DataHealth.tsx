import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDataHealth, fetchPlaces, type DataHealth as Health } from '../lib/data';
import { exportCsv, exportGpx, exportKml } from '../lib/exports';
import type { Place } from '../lib/types';

const GROUPS: { title: string; rows: { key: string; label: string }[] }[] = [
  {
    title: 'Places',
    rows: [
      { key: 'places_saved', label: 'On the map' },
      { key: 'places_draft', label: 'Drafts' },
      { key: 'places_bucket', label: 'Bucket list' },
      { key: 'places_trash', label: 'In trash' },
    ],
  },
  {
    title: 'Photos',
    rows: [
      { key: 'photos', label: 'Total' },
      { key: 'photos_unassigned', label: 'Unassigned' },
      { key: 'photos_no_date', label: 'No date' },
      { key: 'photos_trash', label: 'In trash' },
    ],
  },
  {
    title: 'Everything else',
    rows: [
      { key: 'visits', label: 'Visits' },
      { key: 'activities', label: 'Activities' },
      { key: 'videos', label: 'Videos' },
      { key: 'pings', label: 'Location pings' },
    ],
  },
];

// Signals that mean something needs looking at (shown only when > 0).
const ISSUES: { key: string; label: string }[] = [
  { key: 'photos_orphaned', label: 'Photos pointing to a place that no longer exists' },
  { key: 'videos_no_poster', label: 'Videos with no thumbnail (need re-upload)' },
  { key: 'activities_no_place', label: 'Activities not attached to a place' },
  { key: 'pings_unattributed', label: 'Location pings with no owner (older imports)' },
  { key: 'strava_tokens_expired', label: 'Expired Strava tokens (a refresh may be failing)' },
];

/** Data-health center — a whole-dataset snapshot + integrity checks + one-tap
 *  export, so the data is easy to trust and recover. */
export default function DataHealth() {
  const [h, setH] = useState<Health | null | undefined>(undefined);
  const [places, setPlaces] = useState<Place[]>([]);
  useEffect(() => {
    fetchDataHealth()
      .then(setH)
      .catch(() => setH(null));
    fetchPlaces()
      .then(setPlaces)
      .catch(() => undefined);
  }, []);

  const issues = h ? ISSUES.filter((i) => (h[i.key] ?? 0) > 0) : [];

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Data health</h1>
      {h === undefined ? (
        <p className="label">Loading…</p>
      ) : !h ? (
        <p className="label">Couldn’t load.</p>
      ) : (
        <>
          {issues.length > 0 && (
            <div className="dh-issues">
              <b>Needs a look</b>
              {issues.map((i) => (
                <div key={i.key} className="dh-issue">
                  <span className="dh-issue-n">{h[i.key]}</span>
                  <span>{i.label}</span>
                </div>
              ))}
            </div>
          )}

          {GROUPS.map((g) => (
            <div key={g.title} className="card dh-group">
              <b>{g.title}</b>
              <div className="dh-stats">
                {g.rows.map((r) => (
                  <div key={r.key} className="dh-stat">
                    <b>{(h[r.key] ?? 0).toLocaleString()}</b>
                    <span className="label">{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <h2 style={{ marginTop: 24 }}>Export a copy</h2>
          <div className="card">
            <p className="label" style={{ margin: '0 0 10px' }}>
              Download everything you can take with you. Nightly off-site backups also run
              automatically.
            </p>
            <div className="btn-row">
              <button onClick={() => exportGpx(places)}>GPX</button>
              <button onClick={() => exportKml(places)}>KML</button>
              <button onClick={() => exportCsv(places)}>CSV</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
