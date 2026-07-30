import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addTripNote,
  deleteTripNote,
  fetchTripNotes,
  fetchTripTimeline,
  type TripNote,
  type TripTimelineItem,
} from '../lib/data';

function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Day-by-day trip itinerary: an AUTO timeline of everything that happened
 *  (activities + spots) with MANUAL plan notes layered on top, per day. */
export default function TripItinerary({ tripId, canEdit }: { tripId: string; canEdit: boolean }) {
  const [items, setItems] = useState<TripTimelineItem[]>([]);
  const [notes, setNotes] = useState<TripNote[]>([]);
  const [addDay, setAddDay] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [newDay, setNewDay] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([fetchTripTimeline(tripId), fetchTripNotes(tripId)])
      .then(([t, n]) => {
        if (!active) return;
        setItems(t);
        setNotes(n);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [tripId]);

  async function reload() {
    setItems(await fetchTripTimeline(tripId).catch(() => []));
    setNotes(await fetchTripNotes(tripId).catch(() => []));
  }
  async function saveNote(day: string) {
    if (!noteText.trim() || !day) return;
    setAddDay(null);
    const txt = noteText.trim();
    setNoteText('');
    try {
      await addTripNote(tripId, day, txt);
    } finally {
      await reload();
    }
  }
  async function delNote(id: string) {
    await deleteTripNote(id).catch(() => undefined);
    await reload();
  }

  const days = [...new Set([...items.map((i) => i.day), ...notes.map((n) => n.day)])].sort();
  if (days.length === 0 && !canEdit) return null;

  return (
    <div className="trip-itin">
      {days.map((day) => (
        <div key={day} className="itin-day">
          <div className="itin-date">{fmtDay(day)}</div>
          {notes
            .filter((n) => n.day === day)
            .map((n) => (
              <div key={n.id} className="itin-note">
                <span>{n.note}</span>
                {canEdit && (
                  <button
                    className="itin-del"
                    title="Delete note"
                    onClick={() => void delNote(n.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          {items
            .filter((i) => i.day === day)
            .map((it, idx) =>
              it.place_id ? (
                <Link key={idx} className="itin-item" to={`/place/${it.place_id}/day/${day}`}>
                  <b>{it.title}</b>
                  {it.sub && <span className="label"> — {it.sub}</span>}
                </Link>
              ) : (
                <div key={idx} className="itin-item">
                  <b>{it.title}</b>
                  {it.sub && <span className="label"> — {it.sub}</span>}
                </div>
              ),
            )}
          {canEdit &&
            (addDay === day ? (
              <div className="itin-add">
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a plan note…"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && void saveNote(day)}
                />
                <button className="primary" onClick={() => void saveNote(day)}>
                  Add
                </button>
              </div>
            ) : (
              <button className="link-btn" onClick={() => setAddDay(day)}>
                + note
              </button>
            ))}
        </div>
      ))}

      {canEdit && (
        <div className="itin-newday">
          <input
            type="date"
            aria-label="Note date"
            value={newDay}
            onChange={(e) => setNewDay(e.target.value)}
          />
          <input
            value={addDay === '__new' ? noteText : ''}
            onFocus={() => setAddDay('__new')}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Plan note for another day…"
            onKeyDown={(e) => e.key === 'Enter' && newDay && void saveNote(newDay)}
          />
          <button
            className="primary"
            disabled={!newDay || !noteText.trim()}
            onClick={() => newDay && void saveNote(newDay)}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
