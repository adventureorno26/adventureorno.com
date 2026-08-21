// Everything you did with one person.
//
// §8b-i asks for two things and 0247 delivered only the first: *"A user can tag any person,
// FIND ANYONE TAGGED IN THEIR PHOTOS/MEMORIES, retrieve everything they did with one or
// several people."* Tagging without retrieval is half a feature — you could say who was in a
// photograph and there was no way to ask for the ones with them in.
//
// `/people/:personId` is a target route in the approved navigation, and this is it.
//
// WHAT IT ANSWERS, precisely: everything THAT PERSON did which you are allowed to see —
// which includes things they did on their own. It is not "what we did together": that is the
// people multi-select with ALL/ANY, which §8b-i also asks for and which is not built. The
// first version of this page had a "Miles together" tile summing exactly this list, which
// reads as one fact and is another.
//
// TWO THINGS IT WILL NOT DO. It never sums a photograph with an outing — §8b-i names that one
// ("photo presence not silently promoted to outing participation"), so being in a picture
// taken during a run puts nothing on anybody's mileage. And a pending tag is labelled, never
// counted as agreed: a question shown as a fact is the failure 0243 fixed everywhere else.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AuthedImg from '../components/AuthedImg';
import {
  fetchMemoriesWithPeople,
  fetchMyPeople,
  type PersonContact,
  type PersonMemory,
} from '../lib/memoryPeople';

const MILES = 1609.344;

const dayLabel = (iso: string | null) => {
  if (!iso) return 'Undated';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return 'Undated';
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const KIND_LABEL: Record<string, string> = {
  photo: 'Photo',
  outing: 'Outing',
  visit: 'Visit',
};

export default function PersonPage() {
  const { personId } = useParams<{ personId: string }>();
  const [person, setPerson] = useState<PersonContact | null | undefined>(undefined);
  const [everyone, setEveryone] = useState<PersonContact[]>([]);
  const [rows, setRows] = useState<PersonMemory[] | null | undefined>(undefined);
  // ALSO WITH. §8b-i: "Together is a people query with ALL selected" — so the multi-select
  // is the real control and one person is the degenerate case. `all` is the default because
  // "and also Mum" nearly always means "the ones with both of them in".
  const [also, setAlso] = useState<string[]>([]);
  const [mode, setMode] = useState<'all' | 'any'>('all');

  useEffect(() => {
    if (!personId) return;
    fetchMyPeople()
      .then((list) => {
        setEveryone(list);
        setPerson(list.find((p) => p.id === personId) ?? null);
      })
      .catch(() => setPerson(null));
  }, [personId]);

  useEffect(() => {
    if (!personId) return;
    setRows(undefined);
    fetchMemoriesWithPeople([personId, ...also], also.length ? mode : 'any')
      .then(setRows)
      .catch(() => setRows(null));
  }, [personId, also, mode]);

  const counts = useMemo(() => {
    const c = { photo: 0, outing: 0, visit: 0, pending: 0, miles: 0 };
    for (const r of rows ?? []) {
      if (r.kind in c) c[r.kind as 'photo' | 'outing' | 'visit'] += 1;
      if (r.status === 'proposed') c.pending += 1;
      // MILES COME FROM OUTINGS ONLY. A photograph has no distance and adding one in would
      // be inventing a number.
      if (r.kind === 'outing' && r.status === 'accepted' && r.distance) c.miles += r.distance;
    }
    return c;
  }, [rows]);

  const name = person?.display_name ?? 'This person';

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings">
        <span>Settings</span>
      </Link>
      <h1>{person === undefined ? '…' : name}</h1>

      {/* ALSO WITH — the multi-select §8b-i asks for, in the one place a person is already
          the subject. Its permanent home is the Map's `People: Anyone` drawer. */}
      {everyone.length > 1 && (
        <div className="also-with">
          <span className="label">Also with</span>
          {everyone
            .filter((p) => p.id !== personId)
            .map((p) => (
              <button
                key={p.id}
                className={also.includes(p.id) ? 'on' : ''}
                onClick={() =>
                  setAlso((cur) =>
                    cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id],
                  )
                }
              >
                {p.is_me ? 'Me' : p.display_name}
              </button>
            ))}
          {also.length > 0 && (
            <span className="also-mode">
              <button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>
                All of them
              </button>
              <button className={mode === 'any' ? 'on' : ''} onClick={() => setMode('any')}>
                Any of them
              </button>
            </span>
          )}
        </div>
      )}

      {person === null && (
        <p className="label">
          That isn’t one of your people — or it was removed. Only you can see your own contacts.
        </p>
      )}

      {rows === undefined ? (
        <p className="label">Looking…</p>
      ) : rows === null ? (
        <p className="label">Couldn’t load that.</p>
      ) : rows.length === 0 ? (
        <p className="label">
          Nothing recorded with {name} yet. Tag them in a photo and it will show up here.
        </p>
      ) : (
        <>
          <div className="card person-totals">
            <div className="dh-stats">
              <div className="dh-stat">
                <b>{counts.outing.toLocaleString()}</b>
                <span className="label">Outings</span>
              </div>
              <div className="dh-stat">
                <b>{counts.visit.toLocaleString()}</b>
                <span className="label">Visits</span>
              </div>
              <div className="dh-stat">
                <b>{counts.photo.toLocaleString()}</b>
                <span className="label">Photos</span>
              </div>
              <div className="dh-stat">
                <b>{Math.round(counts.miles / MILES).toLocaleString()}</b>
                {/* NOT "miles together". This page answers "what did Josh do that I can
                    see", which includes outings he recorded on his own — so summing them
                    and calling the total time spent together would be a number that reads
                    as one fact and is another. The people multi-select (ALL/ANY) is what
                    will answer "with", and it is not built. */}
                <span className="label">{also.length ? 'Miles' : 'Their miles'}</span>
              </div>
            </div>
            <p className="label" style={{ margin: '10px 0 0' }}>
              {/* THE SENTENCE FOLLOWS THE FILTER. It said "including things they did on their
                  own" whatever was selected — and with "Also with: Me / All of them" that is
                  the opposite of what is on screen. Same failure as the "Miles together" tile
                  it shipped beside: text that reads as one fact and is another. */}
              {also.length === 0 ? (
                <>
                  Everything here is {name}&rsquo;s, and only what you can see — including things
                  they did on their own.
                </>
              ) : mode === 'all' ? (
                <>Only the ones everybody selected was on, and only what you can see.</>
              ) : (
                <>Anything involving at least one of the people selected, that you can see.</>
              )}{' '}
              An outing counts once however many recordings of it exist. Photos are counted apart
              from outings and add nothing to the miles: being in a picture taken during a run is
              not being on the run.
              {counts.pending > 0 && (
                <>
                  {' '}
                  <b>
                    {counts.pending} {counts.pending === 1 ? 'is' : 'are'} still waiting for an
                    answer
                  </b>{' '}
                  and {counts.pending === 1 ? 'is' : 'are'} not counted above.
                </>
              )}
            </p>
          </div>

          <ul className="person-memories">
            {rows.map((r) => (
              <li key={`${r.kind}:${r.id}`} className={r.status === 'proposed' ? 'pending' : ''}>
                {r.kind === 'photo' && <AuthedImg photoId={r.id} size="thumb" alt="" />}
                <span className="pm-main">
                  <b>{r.title ?? r.place_name ?? KIND_LABEL[r.kind] ?? r.kind}</b>
                  <span className="label">
                    {KIND_LABEL[r.kind] ?? r.kind} · {dayLabel(r.happened_on)}
                    {r.place_name && r.title ? ` · ${r.place_name}` : ''}
                    {r.kind === 'outing' && r.distance
                      ? ` · ${(r.distance / MILES).toFixed(1)} mi`
                      : ''}
                    {r.status === 'proposed' ? ' · waiting for an answer' : ''}
                  </span>
                </span>
                {r.place_id && (
                  <Link className="link-btn" to={`/place/${r.place_id}`}>
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
