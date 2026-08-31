import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createInviteCode,
  formatInviteCode,
  listMyInviteCodes,
  revokeInviteCode,
  type InviteCode,
  type NewInviteCode,
} from '../lib/inviteCodes';
import { whyItFailed } from '../lib/whyItFailed';

/**
 * Invite codes — make one, read it out, take it back.
 *
 * The door is a code now (0288), so somebody has to be able to make one. This is that
 * screen. It sits UNDER Account rather than beside it: Settings has exactly three
 * destinations and this is not a fourth, it is a deeper screen the way
 * `/settings/data/trash` is.
 *
 * ONE CODE, ONE PERSON. Each code works exactly once. That is why "Make a code" is the
 * primary action and there is no quantity field: inviting three people is three codes,
 * and three codes is what makes "who did this let in" answerable afterwards.
 *
 * A CODE IS A SECRET. RLS lets only the issuer (and the owner) read one, so this list is
 * the caller's own. The freshly made one is shown large because that is the moment it
 * gets copied into a text message.
 */

function statusWords(c: InviteCode): string {
  switch (c.status) {
    case 'redeemed':
      return c.redeemed_name ? `Used by ${c.redeemed_name}` : 'Used';
    case 'revoked':
      return 'Revoked';
    case 'expired':
      return 'Expired';
    default: {
      const days = Math.ceil((new Date(c.expires_at).getTime() - Date.now()) / 86400000);
      return days <= 1 ? 'Expires today' : `Expires in ${days} days`;
    }
  }
}

export default function InviteCodes() {
  const [codes, setCodes] = useState<InviteCode[] | null>(null);
  const [fresh, setFresh] = useState<NewInviteCode | null>(null);
  const [note, setNote] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    listMyInviteCodes()
      .then(setCodes)
      .catch((e) => {
        setError(whyItFailed('Couldn’t load your invite codes', e, { online: navigator.onLine }));
        setCodes([]);
      });
  }
  useEffect(load, []);

  async function make() {
    setBusy('new');
    setError(null);
    setCopied(false);
    try {
      const made = await createInviteCode({ note, expiresInDays: days, role });
      setFresh(made);
      setNote('');
      load();
    } catch (e) {
      setError(whyItFailed('Couldn’t make an invite code', e, { online: navigator.onLine }));
    }
    setBusy(null);
  }

  async function revoke(c: InviteCode) {
    setBusy(c.id);
    setError(null);
    try {
      await revokeInviteCode(c.id);
      if (fresh?.id === c.id) setFresh(null);
      load();
    } catch (e) {
      setError(whyItFailed('Couldn’t revoke that code', e, { online: navigator.onLine }));
    }
    setBusy(null);
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(formatInviteCode(code));
      setCopied(true);
    } catch {
      // No clipboard permission — the code is on screen either way, which is the
      // thing that actually matters. Saying "copied" when nothing was copied is worse.
      setCopied(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link className="back-bar" to="/settings/account">
        <span>Settings</span>
      </Link>
      <h1>Invite codes</h1>
      <p className="label" style={{ margin: '0 0 12px' }}>
        Someone can only join with a code from you. Each code lets in <b>one</b> person and then
        stops working — make one code per person you’re inviting.
      </p>

      {error && <div className="banner">{error}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Make a code</h2>
        <input
          placeholder="Who is it for? (optional — only you see this)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <label>
            They can{' '}
            <select value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}>
              <option value="viewer">look around</option>
              <option value="editor">add and edit</option>
            </select>
          </label>
          <label>
            Good for{' '}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
        </div>
        <button
          className="primary"
          style={{ marginTop: 12 }}
          disabled={busy === 'new'}
          onClick={() => void make()}
        >
          {busy === 'new' ? 'Making…' : 'Make a code'}
        </button>

        {fresh && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 26, letterSpacing: '0.12em', fontWeight: 700 }}>
              {formatInviteCode(fresh.code)}
            </div>
            <p className="label" style={{ margin: '6px 0 8px' }}>
              Send this to {fresh.note ? <b>{fresh.note}</b> : 'them'}. They sign in with Google and
              type it in. It works once.
            </p>
            <button onClick={() => void copy(fresh.code)}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        )}
      </div>

      <h2 style={{ marginTop: 28, fontSize: 16 }}>Your codes</h2>
      {codes === null ? (
        <p className="label">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="label">You haven’t made any invite codes yet.</p>
      ) : (
        <div className="card">
          {codes.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderBottom: '1px solid var(--line, rgba(128,128,128,0.25))',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <b
                  style={{
                    letterSpacing: '0.08em',
                    opacity: c.status === 'live' ? 1 : 0.55,
                    textDecoration: c.status === 'live' ? 'none' : 'line-through',
                  }}
                >
                  {formatInviteCode(c.code)}
                </b>
                <div className="label">
                  {statusWords(c)}
                  {c.note ? ` · for ${c.note}` : ''}
                  {c.role === 'editor' ? ' · can add and edit' : ''}
                </div>
              </div>
              {c.status === 'live' && (
                <button disabled={busy === c.id} onClick={() => void revoke(c)}>
                  {busy === c.id ? 'Revoking…' : 'Revoke'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
