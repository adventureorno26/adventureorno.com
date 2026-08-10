// /add — ONE door for getting things in and sorted.
//
// Erica: "I want to add, Import, Edit, Ingest, Sort, fix, etc all in one place… One
// click should take me to a place to add and sort photos and activities and places."
//
// Before this, adding was scattered: an Add tab that redirected to a sheet over the
// map, a photo sorter buried at /photos/sort, and a review queue at /inbox that was a
// sixth destination in the nav. This is the single place, and the Inbox tab is gone.
//
// Places is the other door: this one is for getting things IN, Places is for fixing
// what is already there.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Inbox from './Inbox';
import { fetchInboxCounts } from '../lib/inbox';
import { fetchUnassignedPhotos } from '../lib/photos';

export default function AddPage() {
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState<number | null>(null);
  const [unsorted, setUnsorted] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetchInboxCounts()
      .then((c) => live && setWaiting(c.cards ?? 0))
      .catch(() => live && setWaiting(0));
    fetchUnassignedPhotos()
      .then((p) => live && setUnsorted(p.length))
      .catch(() => live && setUnsorted(0));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="page add-page">
      <div className="page-head">
        <h1>Add</h1>
        <p className="muted">
          Everything that puts something on the map: add it by hand, bring photos in, and say where
          things belong.
        </p>
      </div>

      <div className="add-actions">
        {/* The add sheet still lives over the map, because picking a spot needs the map. */}
        <button className="add-action primary" onClick={() => navigate('/?add=1')}>
          <b>Add a place, visit or activity</b>
          <span className="muted">Drop a pin, search an address, or log an outing.</span>
        </button>

        <Link className="add-action" to="/photos/sort">
          <b>Sort photos{unsorted ? ` · ${unsorted} waiting` : ''}</b>
          <span className="muted">
            From your device or Google Photos — grouped by the day and place they belong to.
          </span>
        </Link>

        <Link className="add-action" to="/import/timeline">
          <b>Import an activity file</b>
          <span className="muted">A GPX or FIT file from a watch or another app.</span>
        </Link>
      </div>

      <h2 className="add-section-head">
        To review{typeof waiting === 'number' && waiting > 0 ? ` · ${waiting}` : ''}
      </h2>
      <p className="muted add-section-blurb">
        Suggestions from the map data. Nothing here has changed anything yet.
      </p>

      {/* The review queue itself. It used to be its own nav tab; it belongs here. */}
      <Inbox embedded />
    </div>
  );
}
