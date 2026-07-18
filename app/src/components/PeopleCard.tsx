import { useEffect, useState } from 'react';
import { fetchInvites, fetchMembers, removeMember, revokeInvite, sendInvite } from '../lib/people';
import type { Invite, Profile, Role } from '../lib/types';

export default function PeopleCard({ meId }: { meId: string }) {
  const [members, setMembers] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [m, i] = await Promise.all([fetchMembers(), fetchInvites()]);
    setMembers(m);
    setInvites(i.filter((inv) => !inv.accepted_at)); // pending only
  }

  useEffect(() => {
    refresh().catch(() => setMsg('Could not load people'));
  }, []);

  async function invite() {
    setBusy(true);
    setMsg(null);
    try {
      await sendInvite(email.trim().toLowerCase(), role);
      setEmail('');
      setMsg(`Invite sent to ${email.trim()}.`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Invite failed');
    }
    setBusy(false);
  }

  async function remove(p: Profile) {
    if (!confirm(`Remove ${p.display_name ?? 'this person'}'s access?`)) return;
    await removeMember(p.id);
    await refresh();
  }

  async function unrevoke(inv: Invite) {
    if (!confirm(`Revoke the pending invite to ${inv.email}?`)) return;
    await revokeInvite(inv.id);
    await refresh();
  }

  return (
    <div className="card">
      <b>People</b>
      <div style={{ marginTop: 8 }}>
        {members.map((m) => (
          <div className="person-row" key={m.id}>
            <span>
              {m.display_name ?? '—'} <span className="tag">{m.role}</span>
            </span>
            {m.role !== 'owner' && m.id !== meId && (
              <button className="danger" onClick={() => void remove(m)}>
                Remove
              </button>
            )}
          </div>
        ))}
        {invites.map((inv) => (
          <div className="person-row" key={inv.id}>
            <span style={{ color: 'var(--muted)' }}>
              {inv.email} <span className="tag">{inv.role} · pending</span>
            </span>
            <button onClick={() => void unrevoke(inv)}>Revoke</button>
          </div>
        ))}
      </div>

      <label style={{ marginTop: 12 }}>Invite someone</label>
      <div className="field-row">
        <input
          type="email"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: 2 }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ flex: 1 }}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button
          className="primary"
          disabled={busy || !email.includes('@')}
          onClick={() => void invite()}
        >
          Send
        </button>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
        Editors can add places, entries, and upload/delete their own photos. Viewers can only look.
        Neither can change settings, the home zone, invites, or Strava — and no one but you can
        issue a device upload token.
      </div>
      {msg && (
        <div className="banner" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
