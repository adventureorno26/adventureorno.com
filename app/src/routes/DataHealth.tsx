import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDataHealth, type DataHealth as Health } from '../lib/data';

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

// THINGS THAT ARE BROKEN, not things waiting for a decision.
//
// This list used to carry "Activities not attached to a place", which is a row on Needs
// attention with a button that does something about it — so the same work appeared on two
// screens and only one of them could act on it. §3e Step 5 split these by verb: /attention
// repairs, and this screen diagnoses and changes nothing. What is left here is the kind of
// thing nobody chose: a reference pointing at a row that is gone, a thumbnail that never
// got made, an import that recorded no owner, a token that stopped refreshing. Each says
// where the fix is, because "something is wrong" with no next step is just worry.
const ISSUES: { key: string; label: string; where: string }[] = [
  {
    key: 'photos_orphaned',
    label: 'Photos pointing to a place that no longer exists',
    where: 'Re-sort them under Import & sort photos',
  },
  {
    key: 'videos_no_poster',
    label: 'Videos with no thumbnail',
    where: 'Upload the video again to regenerate one',
  },
  {
    key: 'pings_unattributed',
    label: 'Location pings with no owner (older imports)',
    where: 'Nothing to do — they predate per-person attribution',
  },
  {
    key: 'strava_tokens_expired',
    label: 'Expired Strava tokens (a refresh may be failing)',
    where: 'Reconnect Strava in Settings',
  },
];

/** Data-health center — a whole-dataset snapshot + integrity checks + one-tap
 *  export, so the data is easy to trust and recover. */
export default function DataHealth() {
  const [h, setH] = useState<Health | null | undefined>(undefined);
  useEffect(() => {
    fetchDataHealth()
      .then(setH)
      .catch(() => setH(null));
  }, []);

  const issues = h ? ISSUES.filter((i) => (h[i.key] ?? 0) > 0) : [];

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings/data/manage">
        <span>Settings</span>
      </Link>
      <h1>Data health</h1>
      {/* SAYING WHAT THIS SCREEN IS FOR, because it used to be a second Needs attention.
          One verb per screen (§3e Step 5): this one only tells you what is true. */}
      <p className="label" style={{ marginTop: -6 }}>
        What is here and what is broken. Nothing on this screen changes anything — the work waiting
        for a decision is on <Link to="/settings/data/attention">Needs attention</Link>.
      </p>
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
                  <span>
                    {i.label}
                    <span className="label"> — {i.where}</span>
                  </span>
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

          {/* THIS CARD USED TO SAY "Download everything you can take with you" over three
              buttons that exported 162 places and nothing else — no activities, no visits,
              no photos, no journal. The sentence was the problem, not the buttons: it told
              her the record was safe on her own disk when almost none of it was. Exporting
              is now one screen that says what each file contains (§3e Step 7). */}
          <h2 style={{ marginTop: 24 }}>Export a copy</h2>
          <div className="card">
            <p className="label" style={{ margin: '0 0 10px' }}>
              The places, the outings, or the whole archive — each says what it contains before you
              download it.
            </p>
            <Link to="/settings/data/export" className="as-button">
              Export &amp; backup
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
