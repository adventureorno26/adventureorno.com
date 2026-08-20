// /add — ONE door for getting things IN.
//
// Erica: "I want to add, Import, Edit, Ingest, Sort, fix, etc all in one place… One
// click should take me to a place to add and sort photos and activities and places."
//
// THE REVIEW QUEUE USED TO LIVE HERE and no longer does. Erica, 2026-08-18: "Needs
// Attention and Review Inbox are redundant." Two screens listed what was waiting, and the
// cards were on the one called Add — so a person looking for something to REPAIR went to
// the page named after CREATING. /inbox even redirected here, which is why the cards were
// so hard to find that she asked where they were.
//
// The split is now by verb, which is the only line that stays put:
//     /add        create and import new information
//     /attention  repair what is already there   ← the cards
//     /health     diagnose the system, change nothing
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchInboxCounts } from '../lib/inbox';

export default function AddPage() {
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetchInboxCounts()
      .then((c) => live && setWaiting(c.cards ?? 0))
      .catch(() => live && setWaiting(0));
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

        {/* Importing/sorting photos and importing activity files moved to SETTINGS
            (Erica, 2026-08-11). They are not adding — they are bulk data work. */}
      </div>

      {/* A POINTER, NOT THE QUEUE. Adding something is when a person is most likely to
          notice there is tidying to do, so the door stays visible here — but the work
          itself happens on the one screen that owns repairing. */}
      {typeof waiting === 'number' && waiting > 0 && (
        <div className="add-actions">
          <Link className="add-action" to="/attention">
            <b>
              {waiting} {waiting === 1 ? 'card is' : 'cards are'} waiting for you
            </b>
            <span className="muted">
              Names to confirm, photos to pin, and outings that may be the same one twice.
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
