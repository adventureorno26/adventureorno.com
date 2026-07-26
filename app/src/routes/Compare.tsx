import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchPlace, fetchPlaceDays } from '../lib/data';
import type { Place, PlaceDay } from '../lib/types';

/** Side-by-side comparison of every time you visited a place — each visit day as
 *  a column with its photos / activities, newest first. Good for repeat spots. */
export default function Compare() {
  const { id } = useParams();
  const [place, setPlace] = useState<Place | null>(null);
  const [days, setDays] = useState<PlaceDay[] | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchPlace(id)
      .then(setPlace)
      .catch(() => undefined);
    fetchPlaceDays(id)
      .then((d) => setDays([...d].sort((a, b) => b.day.localeCompare(a.day))))
      .catch(() => setDays([]));
  }, [id]);

  const fmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  return (
    <div style={{ maxWidth: 900, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to={id ? `/place/${id}` : '/'}>
        <span>Back</span>
      </Link>
      <h1>Compare visits{place ? ` — ${place.name}` : ''}</h1>
      {days === null ? (
        <p className="label">Loading…</p>
      ) : days.length === 0 ? (
        <p className="label">No visit days recorded here yet.</p>
      ) : days.length === 1 ? (
        <p className="label">Only one visit so far — nothing to compare yet.</p>
      ) : (
        <>
          <p className="label" style={{ margin: '0 0 12px' }}>
            {days.length} visits · newest first
          </p>
          <div className="cmp-scroll">
            <div className="cmp-cols">
              {days.map((d) => (
                <Link key={d.day} className="cmp-col" to={`/place/${id}/day/${d.day}`}>
                  <div className="cmp-date">{fmt(d.day)}</div>
                  {d.label && <div className="cmp-label">{d.label}</div>}
                  <div className="cmp-stats">
                    {d.photos > 0 && (
                      <span>
                        {d.photos} photo{d.photos === 1 ? '' : 's'}
                      </span>
                    )}
                    {d.activities > 0 && (
                      <span>
                        {d.activities} activit{d.activities === 1 ? 'y' : 'ies'}
                      </span>
                    )}
                    {d.entries > 0 && (
                      <span>
                        {d.entries} note{d.entries === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <span className="cmp-open">Open day →</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
