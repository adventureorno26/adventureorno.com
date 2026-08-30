// Insights — the third of the four approved destinations.
//
// §"Approved navigation": *"Insights has visible tabs: `Overview | Places | Timeline`, sharing
// one people/time/category scope."* Places and Timeline are the screens that already existed
// as their own tabs; they are not rewritten, they are given a home and a scope. Overview is
// new, and it is the numbers those two are made of.
//
// ONE SCOPE, AT THE TOP, FOR ALL THREE. That is the part worth building carefully: the whole
// point of putting them together is that "who" means the same thing on each. The people
// selection is the same control the Map uses and reads the same `people_memory_keys` rule, so
// a number here can never disagree with a marker there.
//
// EVENTS ARE NOT HERE, deliberately: *"Events do not appear in historical Insights until they
// become history."*
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PeopleFilter from '../components/PeopleFilter';
import { myStats, scopeLabel, scopeSentence, type PeopleSelection } from '../lib/statsScope';
import PlacesList from './PlacesList';
import Timeline from './Timeline';
import { fetchMyPeople, type PersonContact } from '../lib/memoryPeople';
import {
  fetchRaceStatsForPeople,
  fetchWanderStatsForPeople,
  type RaceStat,
  type WanderStats,
} from '../lib/strava';

type Tab = 'overview' | 'places' | 'timeline';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'places', label: 'Places' },
  { id: 'timeline', label: 'Timeline' },
];

const isTab = (v: string | null): v is Tab => TABS.some((t) => t.id === v);

export default function Insights() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'overview';

  // MY STATS, like the Map and like Settings ▸ Stats — §0.2, and the whole point of 0280.
  // This opened on "Anyone" and Settings opened on the old reader's null, which means the
  // OPPOSITE thing: 56 Trips here, 17 there, same account, same moment.
  //
  // NULL UNTIL THE CONTACTS LOAD. Guessing the scope as "no people" would show the retired
  // everybody-number for a frame and then correct itself, which reads as the number moving
  // while you look at it.
  const [people, setPeople] = useState<PeopleSelection | null>(null);
  const [contacts, setContacts] = useState<PersonContact[]>([]);
  useEffect(() => {
    fetchMyPeople()
      .then((c) => {
        setContacts(c);
        setPeople(myStats(c));
      })
      .catch(() => setContacts([]));
  }, []);

  const setTab = (id: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div className="insights">
      <h1 className="insights-title">Insights</h1>

      {/* THE SCOPE, ABOVE THE TABS, because it applies to all of them. Putting it inside a
          tab would say it belongs to that tab. */}
      {people && <PeopleFilter people={contacts} value={people} onChange={setPeople} inline />}

      <div className="insights-tabs" role="tablist" aria-label="Insights">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="insights-body">
        {tab === 'overview' && people && <Overview people={people} contacts={contacts} />}
        {/* The two screens that were destinations of their own until 2026-08-22. `embedded`
            The only thing that changed in them is that their back-bar and their heading
            went with the route they belonged to: the live page read "Map ▸ Places" and
            "Settings ▸ Timeline" INSIDE Insights, offering a way out of a tab and
            repeating its label. Nothing else about either screen was touched. */}
        {tab === 'places' && <PlacesList />}
        {tab === 'timeline' && <Timeline />}
      </div>
    </div>
  );
}

function Overview({ people, contacts }: { people: PeopleSelection; contacts: PersonContact[] }) {
  const [wander, setWander] = useState<WanderStats | null>(null);
  const [races, setRaces] = useState<RaceStat[] | null>(null);

  useEffect(() => {
    let live = true;
    setWander(null);
    setRaces(null);
    fetchWanderStatsForPeople(people.people, people.mode)
      .then((w) => live && setWander(w))
      .catch(() => live && setWander(null));
    fetchRaceStatsForPeople(people.people, people.mode)
      .then((r) => live && setRaces(r))
      .catch(() => live && setRaces([]));
    return () => {
      live = false;
    };
  }, [people]);

  const raceCount = useMemo(() => (races ?? []).reduce((n, r) => n + Number(r.n), 0), [races]);

  // THE WORDS COME FROM THE SAME PLACE THE SCOPE DOES, so Settings ▸ Stats cannot label
  // this number differently from Insights while both are reading it from one reader.
  const label = scopeLabel(people, contacts);
  const sentence = scopeSentence(people, contacts);

  return (
    <>
      <div className="card">
        <div className="dh-stats">
          <div className="dh-stat">
            <b>{wander ? wander.places_count.toLocaleString() : '…'}</b>
            <span className="label">Places</span>
          </div>
          <div className="dh-stat">
            <b>{wander ? Math.round(wander.miles).toLocaleString() : '…'}</b>
            <span className="label">Miles</span>
          </div>
          <div className="dh-stat">
            <b>{wander ? wander.trips_count.toLocaleString() : '…'}</b>
            <span className="label">Trips</span>
          </div>
          <div className="dh-stat">
            <b>{races ? raceCount.toLocaleString() : '…'}</b>
            <span className="label">Races</span>
          </div>
        </div>
        <p className="label" style={{ margin: '10px 0 0' }}>
          <b>{label}</b> — {sentence} A place counts once however many times you went; an outing
          counts once however many recordings of it exist.
        </p>
      </div>

      {races && races.length > 0 && (
        <div className="card">
          <b>Races</b>
          <div className="ex-toc" style={{ marginTop: 8 }}>
            {races
              .slice()
              .sort((a, b) => Number(b.n) - Number(a.n))
              .map((r) => (
                <div key={r.bucket} className="ex-toc-row">
                  <b>{Number(r.n)}</b>
                  <span>
                    {r.bucket}
                    {/* `race_stats` returns MILES, not metres — checked against
                        production rather than assumed from the column name. */}
                    <span className="label"> — {Number(r.miles).toFixed(1)} mi</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}
