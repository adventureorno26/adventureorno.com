// People, on the map.
//
// §8b-i: *"A lightweight `People: Anyone` control opens a multi-select drawer"*, and
// *"Remove `Together / Just me / Just Josh` as the permanent model; Together is a people
// query with ALL selected."*
//
// So this replaces the three-button toggle with a selection, and the old three answers are
// still one tap each — `Anyone` is nothing selected, `Together` selects everybody, and a
// single name is that person. What is new is everything the two-person model could not say:
// two of three people, or somebody who has no account here at all.
//
// TOGETHER SURVIVES AS A SHORTCUT, not as the model. §8b-i allows exactly that — *"a partner
// may be a favourite shortcut"* — and it is the button she has been pressing for months.
//
// AND `Anyone` IS THE DEFAULT NOW, which the old `null` was not: `null` meant SHARED, so the
// map opened on the places they had both been to. It opens on everything you can see.
import type { PersonContact } from '../lib/memoryPeople';

export interface PeopleSelection {
  people: string[];
  mode: 'all' | 'any';
}

export default function PeopleFilter({
  people,
  value,
  onChange,
}: {
  people: PersonContact[];
  value: PeopleSelection;
  onChange: (v: PeopleSelection) => void;
}) {
  // With nobody but yourself recorded there is nothing to choose between.
  if (people.length < 2) return null;

  const linked = people.filter((p) => p.linked_profile);
  const selected = new Set(value.people);

  const toggle = (id: string) => {
    // PRESSING A NAME MEANS THAT PERSON. The first version was a plain multi-select toggle,
    // so from "Together" — where everybody is selected — pressing "Me" REMOVED me and left
    // Josh, and the screen answered a question nobody asked. The old control was three
    // radio buttons and "Me" always meant just me; that has to survive.
    //
    //   part of a wider selection → narrow to this one
    //   the only one selected     → let go of it, back to Anyone
    //   not selected              → add, and two names means both of them
    const next = selected.has(id) ? (value.people.length > 1 ? [id] : []) : [...value.people, id];
    onChange({ people: next, mode: next.length > 1 ? value.mode : 'any' });
  };

  const isTogether =
    linked.length > 1 &&
    value.mode === 'all' &&
    value.people.length === linked.length &&
    linked.every((p) => selected.has(p.id));

  return (
    // KEEPS `person-filter` as well as its own class on purpose: every rule that positions
    // this control, restyles it on a phone and hides it behind an open card is written
    // against that name, and renaming it would quietly drop all of them.
    <div className="person-filter people-filter">
      <button
        className={value.people.length === 0 ? 'on' : ''}
        onClick={() => onChange({ people: [], mode: 'any' })}
      >
        Anyone
      </button>

      {linked.length > 1 && (
        <button
          className={isTogether ? 'on' : ''}
          onClick={() => onChange({ people: linked.map((p) => p.id), mode: 'all' })}
        >
          Together
        </button>
      )}

      {people.map((p) => (
        <button
          key={p.id}
          className={selected.has(p.id) && !isTogether ? 'on' : ''}
          onClick={() => toggle(p.id)}
        >
          {p.is_me ? 'Me' : p.display_name}
        </button>
      ))}

      {/* Only when the answer could differ. For one person it cannot, and a control that
          changes nothing is a control you have to think about for no reason. */}
      {value.people.length > 1 && !isTogether && (
        <span className="people-mode">
          <button
            className={value.mode === 'all' ? 'on' : ''}
            onClick={() => onChange({ ...value, mode: 'all' })}
          >
            All
          </button>
          <button
            className={value.mode === 'any' ? 'on' : ''}
            onClick={() => onChange({ ...value, mode: 'any' })}
          >
            Any
          </button>
        </span>
      )}
    </div>
  );
}
