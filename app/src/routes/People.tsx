// FINDING PEOPLE — "users are found by searching for them" (0283).
//
// Two halves, and they answer different questions:
//
//   the search      who is out there, and what can I do about them
//   your people     where I already stand, with what somebody is waiting on me for FIRST
//
// SEARCH IS A SEARCH, NOT A DIRECTORY. `find_profiles()` needs two characters, returns
// public profiles only, and cannot be walked one letter at a time — so this screen never
// lists everybody, and it says why rather than showing an empty box that looks broken.
//
// EACH RESULT CARRIES THE ACTION THAT FITS IT, from `actionsFor()`. Somebody you have
// already asked shows `Cancel`, not a second `Add` that would return the same pending row;
// somebody who asked YOU shows `Accept` and `Decline`, which is the only place in this app
// where the question is answered.
//
// WHY THE RELATIONSHIP IS FETCHED SEPARATELY: `find_profiles()` publishes only what those
// people chose to publish — no id, no relationship — so `my_connections()` supplies where
// you stand, in one call for the whole screen. Every action reloads it rather than editing
// the row in place: `request_add()` on a pending request the other side already sent
// ACCEPTS it, so assuming "asked" would be a screen reporting something that did not
// happen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ConnectionActions from '../components/ConnectionActions';
import { useAuth } from '../auth/AuthProvider';
import {
  connectionSections,
  relationshipOf,
  relationshipSentence,
  relationshipsFrom,
  type ConnectionRow,
  type Relationship,
} from '../lib/connections';
import {
  fetchMyConnections,
  handlesForIds,
  searchPeople,
  type FoundPerson,
} from '../lib/connectionsApi';
import { whyItFailed } from '../lib/whyItFailed';

export default function People() {
  const { profile } = useAuth();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<FoundPerson[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchProblem, setSearchProblem] = useState<string | null>(null);

  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  const [handles, setHandles] = useState<Map<string, string>>(new Map());
  const [listProblem, setListProblem] = useState<string | null>(null);

  const loadConnections = useCallback(() => {
    fetchMyConnections()
      .then(async (r) => {
        setRows(r);
        setListProblem(null);
        // A name is not a link. The profile route is keyed by handle, and my_connections()
        // does not return one — a blocked person has no handle here either, because the
        // `profiles` policy will not show us their row. Those rows render unlinked.
        setHandles(await handlesForIds(r.map((x) => x.profile_id)).catch(() => new Map()));
      })
      .catch((e) => {
        setRows([]);
        setListProblem(whyItFailed('Couldn’t load your people', e, { online: navigator.onLine }));
      });
  }, []);

  useEffect(loadConnections, [loadConnections]);

  // Typing is not a query per keystroke. 250ms is long enough to finish a word and short
  // enough that the list feels attached to the box.
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      setSearchProblem(null);
      return;
    }
    setSearching(true);
    let live = true;
    const t = setTimeout(() => {
      searchPeople(q)
        .then((r) => {
          if (!live) return;
          // Your own account is not somebody you can add, and every RPC says so. Dropping
          // it here means the row never offers a button that can only fail.
          setResults(r.filter((p) => p.id !== profile?.id));
          setSearchProblem(null);
        })
        .catch((e) => {
          if (!live) return;
          setResults([]);
          setSearchProblem(whyItFailed('Couldn’t search', e, { online: navigator.onLine }));
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term, profile?.id]);

  const rels = useMemo(() => relationshipsFrom(rows ?? []), [rows]);
  const sections = useMemo(() => connectionSections(rows ?? []), [rows]);

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings/account">
        <span>Account</span>
      </Link>
      <h1>People</h1>
      <p className="label">
        People are found by searching for them. Only accounts that made their profile public can be
        found, and only what they published is shown.
      </p>

      <div className="card people-search">
        <label htmlFor="people-search-input" className="label">
          Search by handle or name
        </label>
        <input
          id="people-search-input"
          type="search"
          autoComplete="off"
          placeholder="handle or name"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {term.trim().length > 0 && term.trim().length < 2 && (
          <p className="label">Two characters or more, so a search cannot ask for everybody.</p>
        )}
        {searchProblem && <p className="label">{searchProblem}</p>}
        {searching && <p className="label">Looking…</p>}
        {!searching && results !== null && results.length === 0 && !searchProblem && (
          <p className="label">
            Nobody by that name. Either there is no such account, or it has not been made public —
            this app cannot tell you which.
          </p>
        )}
        {results !== null && results.length > 0 && (
          <div className="person-rows">
            {results.map((p) => (
              <PersonRow
                key={p.id}
                id={p.id}
                handle={p.handle}
                name={p.display_name}
                bio={p.bio}
                avatar={p.avatar_url}
                sentence={relationshipSentence(relationshipOf(rels, p.id))}
                rel={relationshipOf(rels, p.id)}
                onChanged={loadConnections}
              />
            ))}
          </div>
        )}
      </div>

      <h2>Your people</h2>
      {listProblem && <p className="label">{listProblem}</p>}
      {rows === null ? (
        <p className="label">Loading…</p>
      ) : sections.length === 0 ? (
        <p className="label">
          Nobody yet. Search above, then add somebody — an add is mutual, so they decide too.
        </p>
      ) : (
        sections.map((s) => (
          <div className="card" key={s.key}>
            <b>{s.title}</b>
            <p className="label">{s.note}</p>
            <div className="person-rows">
              {s.people.map((p) => (
                <PersonRow
                  key={p.id}
                  id={p.id}
                  handle={handles.get(p.id) ?? null}
                  name={p.display_name}
                  bio={null}
                  avatar={null}
                  sentence={relationshipSentence(p.rel)}
                  rel={p.rel}
                  onChanged={loadConnections}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function PersonRow({
  id,
  handle,
  name,
  bio,
  avatar,
  sentence,
  rel,
  onChanged,
}: {
  id: string;
  handle: string | null;
  name: string | null;
  bio: string | null;
  avatar: string | null;
  sentence: string;
  rel: Relationship;
  onChanged: () => void;
}) {
  const label = name?.trim() || (handle ? `@${handle}` : 'Someone');
  return (
    <div className="person-row connection-row">
      <div className="connection-who">
        {avatar && <img className="connection-avatar" src={avatar} alt="" />}
        <div>
          {handle ? (
            <Link to={`/profile/${handle}`}>{label}</Link>
          ) : (
            // No handle means the `profiles` row is not readable — which, on this screen,
            // means a block. There is nothing to link to.
            <span>{label}</span>
          )}
          {handle && name?.trim() && <span className="tag">@{handle}</span>}
          <p className="label">{sentence}</p>
          {bio && <p className="label">{bio}</p>}
        </div>
      </div>
      <ConnectionActions profileId={id} rel={rel} onChanged={onChanged} />
    </div>
  );
}
