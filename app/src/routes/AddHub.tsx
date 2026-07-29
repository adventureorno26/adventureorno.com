import { Link } from 'react-router-dom';

// The "Add" destination — a simple launcher for the ways to add to the map.
// Phase 3 replaces this with a single guided Place → Visit wizard; for now it
// surfaces the existing entry points (the photo sorter was previously buried in
// Settings). Plain language, no database terms.

const ACTIONS: { to: string; title: string; blurb: string; primary?: boolean }[] = [
  {
    to: '/photos/sort',
    title: 'Add photos',
    blurb: 'Sort photos into places and log a visit — from your device or Google Photos.',
    primary: true,
  },
  {
    to: '/places',
    title: 'Find a place',
    blurb: 'Browse everywhere you’ve been, open a place, and log another visit.',
  },
  {
    to: '/bucket',
    title: 'Bucket list',
    blurb: 'Save somewhere you want to go next.',
  },
];

export default function AddHub() {
  return (
    <div className="add-hub">
      <Link className="back-bar" to="/">
        <span>Map</span>
      </Link>
      <h1>Add</h1>
      <p className="add-hub-sub">What would you like to add?</p>
      <div className="add-hub-grid">
        {ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className={`add-hub-card${a.primary ? ' primary' : ''}`}>
            <b>{a.title}</b>
            <span>{a.blurb}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
