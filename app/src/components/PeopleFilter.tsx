// The scope control — §0.2, approved 2026-08-30. What a scope IS lives in lib/statsScope;
// this is only how you change it.
//
//   My Stats           every card I am tagged on. Everything opens here.
//   Our Stats          only the cards ALL the selected people AND I are tagged on.
//
// WHAT THIS CONTROL USED TO SAY, AND WHY NONE OF IT SURVIVED:
//
//   Anyone      gone outright. It only ever meant "everyone in this household", and there
//               is no household. It was also the DEFAULT, which is how /insights came to
//               report 56 trips while Settings ▸ Stats reported 17 — see migration 0280.
//   Together    it did not name who, and it stopped being true at three people.
//   All / Any   the operator is gone. Our Stats is the overlap, always.
//
// A PERSON'S OWN STATS ARE NOT HERE. §0.2: *"Seen by opening their profile — never a pill
// on my map."* Selecting Josh alone would answer a question about Josh on a screen that is
// about me, so this control cannot express it and /person/:id still can.
import type { PersonContact } from '../lib/memoryPeople';
import { othersInScope, type PeopleSelection } from '../lib/statsScope';

export default function PeopleFilter({
  people,
  value,
  onChange,
  inline = false,
}: {
  people: PersonContact[];
  value: PeopleSelection;
  onChange: (v: PeopleSelection) => void;
  /** The Map pins this control to the bottom-left; Insights and Settings put it in the page
   *  flow above what it scopes, because there it is the scope for everything below rather
   *  than an overlay on something. Same control, same rule, two placements. */
  inline?: boolean;
}) {
  const me = people.find((p) => p.is_me);
  const others = people.filter((p) => p.id !== me?.id);
  // With nobody but yourself recorded there is only My Stats, and a control with one
  // answer is a control you have to read for no reason.
  if (!me || others.length === 0) return null;

  const selected = new Set(value.people);
  const mine = othersInScope(value, people).length === 0;

  // ADDING A NAME INTERSECTS; removing the last one lands back on My Stats. I am never
  // removable, because "Our" is what the second scope means.
  const toggle = (id: string) => {
    const next = selected.has(id) ? value.people.filter((x) => x !== id) : [...value.people, id];
    onChange({ people: next.includes(me.id) ? next : [me.id, ...next], mode: 'all' });
  };

  return (
    // KEEPS `person-filter` as well as its own class on purpose: every rule that positions
    // this control, restyles it on a phone and hides it behind an open card is written
    // against that name, and renaming it would quietly drop all of them.
    <div className={`people-filter ${inline ? 'people-filter-inline' : 'person-filter'}`}>
      <button
        className={mine ? 'on' : ''}
        onClick={() => onChange({ people: [me.id], mode: 'all' })}
      >
        My Stats
      </button>

      {others.map((p) => (
        <button
          key={p.id}
          className={selected.has(p.id) ? 'on' : ''}
          onClick={() => toggle(p.id)}
          // WHAT THE SECOND SCOPE COSTS, said out loud. Adding a name can only ever make
          // the number smaller, and a control that silently shrinks a total looks broken.
          title={`Our Stats — only what ${p.display_name} and I were both there for`}
        >
          {p.display_name}
        </button>
      ))}
    </div>
  );
}
