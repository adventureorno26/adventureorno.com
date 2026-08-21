// Who is in this photograph — which has never been answerable before.
//
// §3e Step 6 said "extend tagging to visits, photos and places". Visits and places were done
// in 0240–0246. Photos had no participants of ANY kind: 178 of them, and no way to say who
// is in one, because a participant had to point at `profiles` and only two people can sign
// in here.
//
// THE THREE ANSWERS, and each is a rule already settled rather than a new invention:
//
//   you                      goes on. Your own presence is yours to state (0236).
//   somebody with an account is ASKED (0240). The chip says "asked" until they answer, so the
//                            screen never shows a question as a fact (0243).
//   somebody without one     goes on as YOUR statement, and the record says nobody confirmed
//                            it. There is no account to ask, and pretending otherwise would
//                            be the only dishonest option.
//
// Removing retracts rather than deletes, everywhere, the same as the other three pickers.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addContact,
  fetchMyPeople,
  fetchPhotoPeople,
  tagPersonOnPhoto,
  untagPersonOnPhoto,
  type PersonContact,
  type PhotoPerson,
} from '../lib/memoryPeople';
import { showSnack } from '../lib/snackbar';

export default function PhotoPeople({ photoId, canEdit }: { photoId: string; canEdit: boolean }) {
  const [inIt, setInIt] = useState<PhotoPerson[] | null>(null);
  const [people, setPeople] = useState<PersonContact[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInIt(null);
    setPicking(false);
    fetchPhotoPeople(photoId)
      .then(setInIt)
      .catch(() => setInIt([]));
  }, [photoId]);

  async function openPicker() {
    setPicking(true);
    if (people) return;
    try {
      setPeople(await fetchMyPeople());
    } catch {
      setPeople([]);
    }
  }

  async function reload() {
    setInIt(await fetchPhotoPeople(photoId).catch(() => inIt ?? []));
  }

  async function tag(person: PersonContact) {
    setBusy(true);
    try {
      const outcome = await tagPersonOnPhoto(photoId, person.id);
      await reload();
      // ASKED IS NOT THERE. Saying "added" about a question is the failure 0243 fixed for
      // the other three pickers; this one is built that way from the start.
      showSnack({
        message: outcome.asked
          ? `Asked ${person.display_name}. It counts for them once they say yes.`
          : `${person.is_me ? 'You are' : `${person.display_name} is`} in this one.`,
      });
    } catch (e) {
      showSnack({ message: e instanceof Error ? e.message : 'Could not add them.' });
    } finally {
      setBusy(false);
    }
  }

  async function addAndTag() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const id = await addContact(name);
      setNewName('');
      setPeople(await fetchMyPeople().catch(() => people ?? []));
      await tagPersonOnPhoto(photoId, id);
      await reload();
      showSnack({ message: `${name} is in this one. Nobody else can see your contacts.` });
    } catch (e) {
      showSnack({ message: e instanceof Error ? e.message : 'Could not add them.' });
    } finally {
      setBusy(false);
    }
  }

  async function untag(p: PhotoPerson) {
    setBusy(true);
    try {
      await untagPersonOnPhoto(photoId, p.person_id);
      await reload();
      showSnack({ message: `Took ${p.display_name} off this one.` });
    } catch (e) {
      showSnack({ message: e instanceof Error ? e.message : 'Could not remove them.' });
    } finally {
      setBusy(false);
    }
  }

  if (inIt === null) return null;

  const alreadyIn = new Set(inIt.map((p) => p.person_id));
  const choices = (people ?? []).filter((p) => !alreadyIn.has(p.id));

  return (
    <div className="ph-people" onClick={(e) => e.stopPropagation()}>
      <div className="ph-people-row">
        {inIt.map((p) => (
          <span
            key={p.person_id}
            className={`ph-person ${p.participation_status === 'proposed' ? 'pending' : ''}`}
          >
            {/* The name opens their page: everything you did with them, which is the other
                half of §8b-i. */}
            <Link to={`/people/${p.person_id}`} className="ph-person-link">
              {p.display_name}
            </Link>
            {/* A tag that has been asked and not answered says so, rather than looking
                like everyone else's. */}
            {p.participation_status === 'proposed' && <span className="ph-asked"> · asked</span>}
            {canEdit && (
              <button
                className="ph-person-x"
                disabled={busy}
                onClick={() => void untag(p)}
                aria-label={`Take ${p.display_name} off this photo`}
                title={`Take ${p.display_name} off this photo`}
              >
                ×
              </button>
            )}
          </span>
        ))}

        {canEdit && !picking && (
          <button className="ph-add" disabled={busy} onClick={() => void openPicker()}>
            {inIt.length ? 'Add someone' : 'Who’s in this?'}
          </button>
        )}
      </div>

      {canEdit && picking && (
        <div className="ph-picker">
          {people === null ? (
            <span className="label">Loading…</span>
          ) : (
            <>
              {choices.map((p) => (
                <button
                  key={p.id}
                  className="ph-choice"
                  disabled={busy}
                  onClick={() => void tag(p)}
                >
                  {p.is_me ? 'Me' : p.display_name}
                </button>
              ))}
              {/* SOMEBODY WITH NO ACCOUNT. This is the whole reason 0247 exists: a person
                  does not have to be able to sign in here to have been there. */}
              <span className="ph-new">
                <input
                  value={newName}
                  placeholder="Someone else…"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addAndTag()}
                  aria-label="Add someone who isn’t on the list"
                />
                <button disabled={busy || !newName.trim()} onClick={() => void addAndTag()}>
                  Add
                </button>
              </span>
              <button className="link-btn" onClick={() => setPicking(false)}>
                Done
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
