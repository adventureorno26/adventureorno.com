// ONE PERSON'S PUBLIC PAGE — `/profile/:handle`, the card `public_profile()` returns.
//
// THE STATS ON IT ARE THEIRS, ALL OF THEM. docs/STATE.md §0.2: *"a person's own stats: all
// of theirs, including the cards we share"*, and *"seen by opening their profile — never a
// pill on my map"*. So there is no scope control on this page and there is nothing to
// intersect with — the totals are the whole of that person's history, which is why
// `public_profile()` reads the base tables rather than the `security_invoker` views that
// would have answered a stranger with zero.
//
// AND ONLY WHAT THEY PUBLISHED. Totals, places and recent activity are three separate
// switches on their account; each section is here only when its switch is on, and a switch
// that is off is said plainly rather than shown as an empty list, which reads as "they have
// never been anywhere".
//
// ONE ANSWER FOR THREE DIFFERENT SITUATIONS — no such handle, an account that is private,
// and a block between you. All three land on the same "no page here", deliberately: 0283
// built the first two so a private account cannot be confirmed to exist, and lib/
// connectionsApi adds the third, because `public_profile()` itself still carries the TODO.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ConnectionActions from '../components/ConnectionActions';
import { useAuth } from '../auth/AuthProvider';
import {
  relationshipOf,
  relationshipSentence,
  relationshipsFrom,
  type ConnectionRow,
} from '../lib/connections';
import {
  fetchMyConnections,
  fetchPublicProfile,
  type PublicProfileCard,
} from '../lib/connectionsApi';
import { whyItFailed } from '../lib/whyItFailed';

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

export default function PublicProfile() {
  const { handle = '' } = useParams<{ handle: string }>();
  const { profile } = useAuth();
  // `undefined` is "still looking"; `null` is the one answer given for a handle that does
  // not exist, an account that is private, and a block.
  const [card, setCard] = useState<PublicProfileCard | null | undefined>(undefined);
  const [theirId, setTheirId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [rows, setRows] = useState<ConnectionRow[]>([]);

  const loadConnections = useCallback(() => {
    fetchMyConnections()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  // The card and the relationship are reloaded together after an action: blocking somebody
  // removes their page from you, so the page has to be able to disappear under its own
  // button.
  const load = useCallback(() => {
    setCard(undefined);
    setProblem(null);
    fetchPublicProfile(handle)
      .then((found) => {
        setCard(found?.card ?? null);
        setTheirId(found?.id ?? null);
      })
      .catch((e) => {
        setCard(null);
        setProblem(whyItFailed('Couldn’t open that profile', e, { online: navigator.onLine }));
      });
    loadConnections();
  }, [handle, loadConnections]);

  useEffect(load, [load]);

  const rel = relationshipOf(relationshipsFrom(rows), theirId);
  const isMe = Boolean(theirId && profile?.id === theirId);

  if (card === undefined) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <Link className="back-bar" to="/people">
          <span>People</span>
        </Link>
        <p className="label">Looking…</p>
      </div>
    );
  }

  if (card === null) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <Link className="back-bar" to="/people">
          <span>People</span>
        </Link>
        <h1>No page here</h1>
        <p className="label">
          {problem ??
            'There is no public profile at that handle. It may not exist, or it may not be public — this app will not tell you which.'}
        </p>
      </div>
    );
  }

  const name = card.display_name?.trim() || `@${card.handle}`;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/people">
        <span>People</span>
      </Link>

      <div className="card profile-head">
        {card.avatar_url && <img className="profile-avatar" src={card.avatar_url} alt="" />}
        <div>
          <h1>{name}</h1>
          <p className="label">@{card.handle}</p>
          {card.bio && <p>{card.bio}</p>}
          {card.member_since && <p className="label">Here since {dayLabel(card.member_since)}</p>}
        </div>
      </div>

      {isMe ? (
        <p className="label">
          This is your own public page — what anybody who finds you sees. Change what it carries in
          Settings.
        </p>
      ) : theirId ? (
        <div className="card">
          <p className="label">{relationshipSentence(rel)}</p>
          <ConnectionActions profileId={theirId} rel={rel} onChanged={load} size="page" />
        </div>
      ) : null}

      {/* THEIR OWN TOTALS. Not the overlap with mine, and not the slice I can see. */}
      {card.shows.stats && card.stats ? (
        <div className="card">
          <b>Their stats</b>
          <p className="label">
            All of theirs — every place, mile and trip of their own, whether or not it is anything
            to do with you.
          </p>
          <div className="dh-stats">
            <div className="dh-stat">
              <b>{card.stats.places.toLocaleString()}</b>
              <span className="label">Places</span>
            </div>
            <div className="dh-stat">
              <b>{Number(card.stats.miles).toLocaleString()}</b>
              <span className="label">Miles</span>
            </div>
            <div className="dh-stat">
              <b>{card.stats.trips.toLocaleString()}</b>
              <span className="label">Trips</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="label">They have not made their stats public.</p>
      )}

      {card.shows.places && card.places ? (
        <div className="card">
          <b>Places they have been</b>
          <p className="label">{card.places.length.toLocaleString()} published by them.</p>
          <div className="person-rows">
            {card.places.map((pl) => (
              <div className="person-row" key={`${pl.name}-${pl.lat}-${pl.lng}`}>
                <span>{pl.name}</span>
                <span className="label">
                  {pl.visits.toLocaleString()} {pl.visits === 1 ? 'visit' : 'visits'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {card.shows.activity && card.activity ? (
        <div className="card">
          <b>Recently</b>
          <div className="person-rows">
            {card.activity.map((a, i) => (
              <div className="person-row" key={`${a.kind}-${a.happened_on}-${i}`}>
                <span>
                  {a.title?.trim() || (a.kind === 'visit' ? 'Visit' : 'Outing')}
                  {a.place_name && <span className="tag">{a.place_name}</span>}
                </span>
                <span className="label">
                  {dayLabel(a.happened_on)}
                  {a.distance ? ` · ${(a.distance / MILES).toFixed(1)} mi` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
