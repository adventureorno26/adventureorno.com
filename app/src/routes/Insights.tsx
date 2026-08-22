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
import PeopleFilter, { type PeopleSelection } from '../components/PeopleFilter';
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

  // ANYONE, like the Map. The old default was SHARED — only what both of them were on —
  // and the approved control opens on everything you can see.
  const [people, setPeople] = useState<PeopleSelection>({ people: [], mode: 'any' });
  const [contacts, setContacts] = useState<PersonContact[]>([]);
  useEffect(() => {
    fetchMyPeople()
      .then(setContacts)
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
      <PeopleFilter people={contacts} value={people} onChange={setPeople} inline />

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
        {tab === 'overview' && <Overview people={people} contacts={contacts} />}
        {/* The two screens that were tabs of their own until 2026-08-22. Unchanged: they are
            given a home, not rewritten. */}
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

  const who = useMemo(() => {
    if (!people.people.length) return 'Anyone';
    const names = people.people.map(
      (id) => contacts.find((c) => c.id === id)?.display_name ?? 'them',
    );
    if (names.length === 1) return names[0];
    return names.join(people.mode === 'all' ? ' and ' : ' or ');
  }, [people, contacts]);

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
          {who === 'Anyone'
            ? 'Everything you can see.'
            : `Only what ${who} ${people.people.length > 1 && people.mode === 'all' ? 'were all' : 'was'} on.`}{' '}
          A place counts once however many times you went; an outing counts once however many
          recordings of it exist.
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
