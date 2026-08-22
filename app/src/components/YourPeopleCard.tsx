// Your people — the ones you can tag, which is not the same list as who can sign in.
//
// The card above this one is MEMBERSHIP: accounts, roles, invitations. This one is people.
// §8b-i keeps them apart on purpose — "account access separate from memory participation" —
// and a person here needs no account at all. That is the whole change 0247 made: before it,
// the only people who could appear anywhere in this app were the two who could log in to it.
//
// A TEMPORARY HOME, said out loud. The approved navigation puts people selection on the Map
// ("a lightweight `People: Anyone` control opens a multi-select drawer") and on Insights,
// neither of which is built. Until then this is how a person's page is reachable at all —
// otherwise the only door would be a tag chip on a photograph, and there are no tags yet.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addContact, fetchMyPeople, type PersonContact } from '../lib/memoryPeople';
import { showSnack } from '../lib/snackbar';

export default function YourPeopleCard() {
  const [people, setPeople] = useState<PersonContact[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMyPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  async function add() {
    const v = name.trim();
    if (!v) return;
    setBusy(true);
    try {
      await addContact(v);
      setName('');
      setPeople(await fetchMyPeople());
      showSnack({ message: `Added ${v}. Only you can see your own people.` });
    } catch (e) {
      showSnack({ message: e instanceof Error ? e.message : 'Could not add them.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 13 }}>
        The people you can tag in photos. They don’t need an account here — that’s the point. These
        are yours alone: nobody else can see your list.
      </p>

      {people === null ? (
        <p className="label">Loading…</p>
      ) : (
        <div className="btn-row" style={{ marginBottom: 10 }}>
          {people.map((p) => (
            <Link key={p.id} to={`/people/${p.id}`} className="as-button">
              {p.is_me ? 'Me' : p.display_name}
            </Link>
          ))}
        </div>
      )}

      <div className="ph-new">
        <input
          value={name}
          placeholder="Add someone…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          aria-label="Add a person"
        />
        <button disabled={busy || !name.trim()} onClick={() => void add()}>
          Add
        </button>
      </div>
    </div>
  );
}
