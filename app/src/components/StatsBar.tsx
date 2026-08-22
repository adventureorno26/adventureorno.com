import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MileageRow, Place } from '../lib/types';
import type { PeopleSelection } from './PeopleFilter';
import {
  fetchActivitiesOfTypeForPeople,
  fetchMileageForPeople,
  fetchRacesListForPeople,
  fetchRaceStatsForPeople,
  fetchWanderStatsForPeople,
  type ActivityListRow,
  type RaceRow,
  type RaceStat,
  type WanderStats,
} from '../lib/strava';
import { fetchAllEntries } from '../lib/data';

interface Props {
  places: Place[];
  onFilterCategory: (slug: string | null) => void;
  // WHO the numbers are about (0261). The same selection the markers use, so the two can
  // never say different things about the same screen — with "Anyone" chosen the map would
  // otherwise show 135 places while the miles beside them counted the 54 they had been to
  // together, each correct alone and the pair of them a lie.
  peopleSel?: PeopleSelection;
  // Place ids in the current person view, from place_ids_for_view — the SAME
  // filter the map and wander_stats use. Null while it is still loading.
  viewSet?: Set<string> | null;
}

// Strava activity type → map filter category.
const STRAVA_CAT: Record<string, string> = {
  Run: 'running',
  Hike: 'hiking',
  Walk: 'walking',
  Ride: 'biking',
};

// Human noun for an activity count, e.g. Run → "runs", Ride → "rides".
const ACTIVITY_NOUN: Record<string, string> = {
  Run: 'run',
  Hike: 'hike',
  Walk: 'walk',
  Ride: 'ride',
};
function activityNoun(type: string, n: number): string {
  const base = ACTIVITY_NOUN[type] ?? 'activity';
  if (n === 1) return base;
  return base === 'activity' ? 'activities' : `${base}s`;
}

/** Count up to `target` over ~700ms with requestAnimationFrame. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const from = 0;
    const dur = 700;
    // A HIDDEN TAB HAS NO ANIMATION FRAMES, so this counted from zero and stopped there.
    // The number is the point; the count-up is decoration, and decoration nobody can see is
    // not worth showing a 0.0 for. Measured on production: visibilityState "hidden",
    // requestAnimationFrame never fired, and the pill read 0.0 miles for twenty seconds.
    //
    // It self-healed the moment the tab came forward, so she would rarely have seen it — but
    // it also meant the number could not be READ by anything automated, and four screenshots
    // taken through it produced four different values off the same curve. I wrote those up as
    // a defect in the stats bar. They were a defect in the instrument.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      setValue(target);
      return;
    }
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    startRef.current = null;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

export default function StatsBar({
  places,
  onFilterCategory,
  peopleSel = { people: [], mode: 'any' },
  viewSet = null,
}: Props) {
  // Only saved, non-bucket places count, and only those in the current view.
  //
  // This used to filter on the place-level `solo_profile` column, which was null
  // for 129 of 132 places — so nothing was ever excluded and the Army Ten Miler
  // showed up under "Just Josh". Attribution lives on the VISIT (docs/STATE.md §0.3),
  // so the list now uses place_ids_for_view: the same filter as the map markers
  // and the headline count, which is why they agree.
  const visited = places.filter(
    (p) =>
      !p.bucket &&
      p.saved &&
      p.name.trim() !== '' && // skip unnamed drafts
      (!viewSet || viewSet.has(p.id)),
  );
  // Main bar shows Places + Miles + Races. Cities/States moved to Settings.
  const [detail, setDetail] = useState<null | 'places' | 'miles' | 'races'>(null);
  const [typeList, setTypeList] = useState<{ type: string; rows: ActivityListRow[] } | null>(null);
  const placeList = [...visited].sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (k: typeof detail) => {
    setTypeList(null);
    setDetail((cur) => (cur === k ? null : k));
  };
  const closeDetail = () => {
    setTypeList(null);
    setDetail(null);
  };

  // Trails + Spots + Places all count. Trails/places are already in `visited`;
  // notes (entries) add to the total AND the drill-down list. Visits are NOT
  // counted (they're repeat trips to a place already counted).
  const [notes, setNotes] = useState<{ id: string; place_id: string; title: string }[]>([]);
  useEffect(() => {
    fetchAllEntries()
      .then((rows) =>
        setNotes(rows.map((r) => ({ id: r.id, place_id: r.place_id, title: r.title }))),
      )
      .catch(() => setNotes([]));
  }, [places.length]);
  // A spot belongs to its place, so it follows the same view filter.
  const visitedIds = new Set(visited.map((p) => p.id));
  const viewNotes = notes.filter((s) => visitedIds.has(s.place_id));
  const placesTotal = visited.length + viewNotes.length;

  // Combined drill-down: every place AND every spot, alphabetical.
  const placeName = (id: string) => places.find((p) => p.id === id)?.name ?? '';
  const combinedList = [
    ...placeList.map((p) => ({
      id: p.id,
      label: p.name,
      sub: p.admin1 ?? '',
      to: `/place/${p.id}`,
    })),
    ...viewNotes.map((s) => ({
      id: s.id,
      label: s.title,
      sub: placeName(s.place_id),
      to: `/place/${s.place_id}`,
    })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const [mileage, setMileage] = useState<MileageRow[]>([]);
  useEffect(() => {
    fetchMileageForPeople(peopleSel.people, peopleSel.mode)
      .then(setMileage)
      .catch(() => setMileage([]));
  }, [places.length, peopleSel]); // refresh on data change or person toggle

  // Headline places + miles come from the visit-level model (wander_stats): each
  // place counted once, miles/trips per person, one cutoff. The drill-down lists
  // above stay as-is (they're the detail view). Falls back to the local tallies
  // if the RPC hasn't answered yet.
  const [wander, setWander] = useState<WanderStats | null>(null);
  useEffect(() => {
    fetchWanderStatsForPeople(peopleSel.people, peopleSel.mode)
      .then(setWander)
      .catch(() => setWander(null));
  }, [places.length, peopleSel]);

  // Races: each running counts (race_stats buckets); races_list is one row per
  // named race, so tapping a race opens it to see every time it was run.
  const [raceStats, setRaceStats] = useState<RaceStat[]>([]);
  const [racesList, setRacesList] = useState<RaceRow[]>([]);
  useEffect(() => {
    fetchRaceStatsForPeople(peopleSel.people, peopleSel.mode)
      .then(setRaceStats)
      .catch(() => setRaceStats([]));
    fetchRacesListForPeople(peopleSel.people, peopleSel.mode)
      .then(setRacesList)
      .catch(() => setRacesList([]));
  }, [places.length, peopleSel]);
  const raceCount = raceStats.reduce((s, r) => s + Number(r.n), 0);

  // Tapping an activity-type row (e.g. "123 runs") drills into the actual list of
  // those activities, newest first — each links to its day.
  function openType(type: string) {
    setTypeList({ type, rows: [] });
    fetchActivitiesOfTypeForPeople(type, peopleSel.people, peopleSel.mode)
      .then((rows) => setTypeList({ type, rows }))
      .catch(() => setTypeList({ type, rows: [] }));
  }
  const closeType = () => setTypeList(null);

  const placesHeadline = wander ? wander.places_count : placesTotal;
  const totalMiles = wander ? wander.miles : mileage.reduce((sum, r) => sum + Number(r.miles), 0);
  const animated = useCountUp(totalMiles);

  return (
    <div className="stats-bar">
      <div className="stat-row">
        <button
          className={`stat ${detail === 'places' ? 'on' : ''}`}
          onClick={() => toggle('places')}
        >
          <b>{placesHeadline}</b> <span className="label">places</span>
        </button>
        <button
          className={`stat ${detail === 'miles' ? 'on' : ''}`}
          onClick={() => toggle('miles')}
        >
          <b>{animated.toFixed(1)}</b> <span className="label">miles</span>
        </button>
        {/* TRIPS IS NOT HERE. Erica: "I did not want Trips in the toggle on the main
            page, I wanted it under Stats." It lives in Settings › Stats, where the
            whole list opens. */}
        {raceCount > 0 && (
          <button
            className={`stat ${detail === 'races' ? 'on' : ''}`}
            onClick={() => toggle('races')}
          >
            <b>{raceCount}</b> <span className="label">{raceCount === 1 ? 'race' : 'races'}</span>
          </button>
        )}
      </div>

      {detail && (
        <div className="stat-detail">
          <div className="stat-detail-head">
            {typeList ? (
              <button className="stat-back" onClick={closeType}>
                ‹ {typeList.type}s ({typeList.rows.length})
              </button>
            ) : (
              <b>
                {detail === 'places'
                  ? 'All places'
                  : detail === 'races'
                    ? 'Races — tap one to see every time you ran it'
                    : 'Activity totals — tap a type to see the list'}
              </b>
            )}
            <button className="stat-detail-x" onClick={closeDetail}>
              ×
            </button>
          </div>
          <div className="stat-detail-list">
            {detail === 'races' && (
              <>
                <div className="race-buckets">
                  {raceStats.map((r) => (
                    <span key={r.bucket} className="race-bucket">
                      <b>{r.n}</b> {r.bucket}
                      {r.n === 1 ? '' : 's'}
                    </span>
                  ))}
                  <span className="race-bucket race-bucket-total">
                    <b>{raceStats.reduce((s, r) => s + Number(r.miles), 0).toFixed(1)}</b> mi
                  </span>
                </div>
                {racesList.map((r) => (
                  <Link key={r.id} to={`/place/${r.id}`} onClick={closeDetail}>
                    {r.name}
                    <span className="label">
                      {' '}
                      · {r.times}× · {r.bucket}
                    </span>
                  </Link>
                ))}
              </>
            )}
            {detail === 'places' &&
              combinedList.map((it) => (
                <Link key={it.id} to={it.to} onClick={closeDetail}>
                  {it.label || 'Untitled'}
                  {it.sub ? <span className="label"> · {it.sub}</span> : null}
                </Link>
              ))}
            {detail === 'miles' &&
              typeList &&
              (typeList.rows.length === 0 ? (
                <span className="label">Loading…</span>
              ) : (
                <>
                  {STRAVA_CAT[typeList.type] && (
                    <button
                      className="mi-row mi-map-row"
                      onClick={() => {
                        onFilterCategory(STRAVA_CAT[typeList.type]);
                        closeDetail();
                      }}
                    >
                      <span className="mi-count">Show all on the map</span>
                      <span className="stat-chev">›</span>
                    </button>
                  )}
                  {typeList.rows.map((a) => (
                    <Link
                      key={a.id}
                      to={
                        a.place_id
                          ? `/place/${a.place_id}${a.start_date ? `/day/${a.start_date.slice(0, 10)}` : ''}`
                          : '#'
                      }
                      onClick={closeDetail}
                    >
                      {a.start_date
                        ? new Date(a.start_date).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : 'Undated'}
                      <span className="label">
                        {' '}
                        · {(a.distance / 1609.344).toFixed(1)} mi
                        {a.place_name ? ` · ${a.place_name}` : ''}
                      </span>
                    </Link>
                  ))}
                </>
              ))}
            {detail === 'miles' &&
              !typeList &&
              (mileage.filter((r) => Number(r.miles) > 0).length === 0 ? (
                <span className="label">No Strava activities yet</span>
              ) : (
                [...mileage]
                  .filter((r) => Number(r.miles) > 0)
                  .sort((a, b) => Number(b.miles) - Number(a.miles))
                  .map((r) => {
                    const n = Number(r.activity_count);
                    return (
                      <button key={r.type} className="mi-row" onClick={() => openType(r.type)}>
                        <span className="mi-count">
                          {n} {activityNoun(r.type, n)}
                        </span>
                        <span className="mi-val">
                          <b>{Number(r.miles).toFixed(1)}</b>
                          <span className="mi-unit">mi</span>
                        </span>
                        <span className="stat-chev">›</span>
                      </button>
                    );
                  })
              ))}
          </div>
        </div>
      )}

      <div className="spacer" />

      <div className="actions">
        <Link to="/settings" className="as-button gear-btn" aria-label="Settings" title="Settings">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
