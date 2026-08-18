import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAttention, type Attention } from '../lib/data';

interface Row {
  key: keyof Attention;
  label: string;
  hint: string;
  to: string;
  action: string;
}

const ROWS: Row[] = [
  // THE REVIEW INBOX, FOLDED IN. Erica, 2026-08-18: "Needs Attention and Review Inbox are
  // redundant. Put anything unique in Review Inbox into needs attentions." The cards were
  // also the half she could not find — /inbox redirects to /add, so nothing on this screen
  // ever pointed at them. They go first because they are the only rows where a person is
  // being ASKED something rather than told a count.
  {
    key: 'reviewCards',
    label: 'Cards waiting for you to decide',
    hint: 'Names to confirm, photos to pin, and outings that may be the same one twice',
    to: '/add',
    action: 'Review them',
  },
  {
    key: 'tagsToConfirm',
    label: 'Outings someone says you were on',
    hint: 'Yours to accept or decline — nothing counts as yours until you say so',
    to: '/add',
    action: 'Answer them',
  },
  {
    key: 'unassignedPhotos',
    label: 'Photos waiting to be sorted',
    hint: 'Uploaded but not yet placed on the map',
    to: '/photos/sort',
    action: 'Sort them',
  },
  {
    key: 'unnamedPlaces',
    label: 'Unnamed places',
    hint: 'Places still called "New place" or left blank',
    to: '/places/edit',
    action: 'Name them',
  },
  {
    key: 'missingCategories',
    label: 'Places with no tags',
    hint: 'Add a type so they show the right marker + reviews',
    to: '/places/edit',
    action: 'Tag them',
  },
  {
    key: 'missingDates',
    label: 'Places with no visit date',
    hint: 'No photos, activities, or dates recorded yet',
    to: '/places/edit',
    action: 'Add dates',
  },
  {
    key: 'photosNoDate',
    label: 'Photos with no date',
    hint: 'Missing capture time — hard to sort into a visit',
    to: '/places/edit',
    action: 'Review',
  },
  {
    key: 'activitiesNoPlace',
    label: 'Activities not attached to a place',
    hint: 'Runs/hikes/rides floating without a place',
    to: '/',
    action: 'Open map',
  },
  // "Trips awaiting confirmation" is gone: auto-detected trip drafts were retired
  // with the trips table (0137). Nothing suggests a trip any more — a trip is a
  // visit a person marked.
];

/** Everything that needs a human touch, in one place — so the automation is easy
 *  to trust. Each row links to where you can fix it. */
export default function AttentionDashboard() {
  const [a, setA] = useState<Attention | null>(null);
  useEffect(() => {
    fetchAttention()
      .then(setA)
      .catch(() => setA(null));
  }, []);

  const rows = a ? ROWS.filter((r) => a[r.key] > 0) : [];
  const allClear = a && rows.length === 0;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Needs attention</h1>
      {!a ? (
        <p className="label">Checking…</p>
      ) : allClear ? (
        <p className="label">All clear — nothing needs attention right now. 🎉</p>
      ) : (
        <div className="attn-list">
          {rows.map((r) => (
            <div key={r.key} className="attn-row">
              <span className="attn-count">{a[r.key]}</span>
              <div className="attn-main">
                <b>{r.label}</b>
                <span className="label">{r.hint}</span>
              </div>
              <Link to={r.to}>
                <button>{r.action}</button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
