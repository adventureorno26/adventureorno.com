import { useEffect, useMemo, useRef, useState } from 'react';
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

  // YEAR -> MONTHS -> DAYS (Erica, 2026-08-15: "in the timeline, the user should see the
  // year, and when clicked that should show the months, then when clicked the days").
  //
  // It used to open on every month of every year at once, which on eight years of data is
  // a wall you scroll past rather than a timeline you read. Nothing loads differently —
  // the same day rows arrive in one call — this is purely how they are folded.
  const years = useMemo(() => {
    const byYear = new Map<string, Map<string, TimelineDay[]>>();
    for (const d of days ?? []) {
      const year = d.date.slice(0, 4);
      const month = d.date.slice(0, 7);
      if (!byYear.has(year)) byYear.set(year, new Map());
      const months = byYear.get(year)!;
      if (!months.has(month)) months.set(month, []);
      months.get(month)!.push(d);
    }
    return [...byYear.entries()].map(([year, months]) => ({
      year,
      months: [...months.entries()].map(([month, list]) => ({ month, list })),
      days: [...months.values()].reduce((n, l) => n + l.length, 0),
    }));
  }, [days]);

  // The newest year is open, and nothing else. Opening the page on a closed list of
  // years would hide the thing she most often wants, which is what she did last.
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || years.length === 0) return;
    seeded.current = true;
    setOpenYears(new Set([years[0].year]));
  }, [years]);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const fmtDay = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  const fmtMonthOnly = (m: string) =>
    new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long' });

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>Timeline</h1>
      {days === null ? (
        <p className="label">Loading…</p>
      ) : days.length === 0 ? (
        <p className="label">Nothing here yet.</p>
      ) : (
        years.map(({ year, months, days: dayCount }) => (
          <div key={year} className="tl-year">
            <button
              type="button"
              className="tl-fold"
              aria-expanded={openYears.has(year)}
              onClick={() => setOpenYears((s) => toggle(s, year))}
            >
              <span className="tl-fold-name">{year}</span>
              <span className="label">
                {dayCount} day{dayCount === 1 ? '' : 's'}
              </span>
            </button>

            {openYears.has(year) &&
              months.map(({ month, list }) => (
                <div key={month} className="tl-month">
                  <button
                    type="button"
                    className="tl-fold tl-fold-month"
                    aria-expanded={openMonths.has(month)}
                    onClick={() => setOpenMonths((s) => toggle(s, month))}
                  >
                    <span className="tl-fold-name">{fmtMonthOnly(month)}</span>
                    <span className="label">
                      {list.length} day{list.length === 1 ? '' : 's'}
                    </span>
                  </button>

                  {openMonths.has(month) &&
                    list.map((d) => (
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
              ))}
          </div>
        ))
      )}
    </div>
  );
}
