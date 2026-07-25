import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTimeline, fetchPlaces, type TimelineDay } from '../lib/data';
import type { Place } from '../lib/types';

/** A single chronological stream of everything — photos + activities by day —
 *  complementing the map. Newest first, grouped by month. */
export default function Timeline() {
  const [days, setDays] = useState<TimelineDay[] | null>(null);
  const [places, setPlaces] = useState<Map<string, Place>>(new Map());

  useEffect(() => {
    fetchTimeline()
      .then(setDays)
      .catch(() => setDays([]));
    fetchPlaces()
      .then((r) => setPlaces(new Map(r.map((p) => [p.id, p]))))
      .catch(() => undefined);
  }, []);

  const months = useMemo(() => {
    const m = new Map<string, TimelineDay[]>();
    for (const d of days ?? []) {
      const key = d.date.slice(0, 7);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(d);
    }
    return [...m.entries()];
  }, [days]);

  const fmtDay = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  const fmtMonth = (m: string) =>
    new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div style={{ maxWidth: 720, margin: '20px auto', padding: '0 16px' }}>
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Timeline</h1>
      {days === null ? (
        <p className="label">Loading…</p>
      ) : days.length === 0 ? (
        <p className="label">Nothing here yet.</p>
      ) : (
        months.map(([month, list]) => (
          <div key={month} className="tl-month">
            <h2 style={{ marginTop: 22 }}>{fmtMonth(month)}</h2>
            {list.map((d) => (
              <div key={d.date} className="tl-day">
                <div className="tl-date">{fmtDay(d.date)}</div>
                <div className="tl-body">
                  {d.photos > 0 && (
                    <div className="label">
                      {d.photos} photo{d.photos === 1 ? '' : 's'}
                    </div>
                  )}
                  {d.activities.map((a, i) => (
                    <div key={i} className="tl-act">
                      {a.place_id ? (
                        <Link to={`/place/${a.place_id}/day/${d.date}`}>{a.name}</Link>
                      ) : (
                        <span>{a.name}</span>
                      )}
                      <span className="label">
                        {' '}
                        · {a.type}
                        {a.miles > 0 ? ` · ${a.miles} mi` : ''}
                      </span>
                    </div>
                  ))}
                  <div className="tl-places">
                    {d.placeIds
                      .map((id) => places.get(id))
                      .filter((p): p is Place => !!p)
                      .map((p) => (
                        <Link key={p.id} to={`/place/${p.id}`} className="tl-place">
                          {p.name}
                        </Link>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
