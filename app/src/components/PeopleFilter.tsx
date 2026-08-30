// The scope control — §0.2, approved 2026-08-30. What a scope IS lives in lib/statsScope;
// this is only how you change it.
//
//   My Stats           every card I am tagged on. Everything opens here.
//   Our Stats          only the cards ALL the picked people AND I are tagged on.
//
// TWO BUTTONS, AND NOBODY'S NAME ON EITHER. Measured on production 2026-08-30 the map read
// `[My Stats] [Josh]` — half of the new model and a pill of the old one, which is worse
// than either alone: `My Stats` is a scope and `Josh` is a person, so the row offered two
// different kinds of answer under one control and neither of them was Our Stats. §0.2 is
// explicit that a person's own history is *"seen by opening their profile — never a pill on
// my map"*, so selecting somebody is no longer something this control can express.
//
// WHY PICKING IS A SEPARATE ACT. Our Stats is a strict intersection, so WHO is in it is the
// whole meaning of the number: `Our Stats` with Josh and `Our Stats` with Josh and Maya are
// different questions wearing one label. Pressing `Our Stats` therefore opens the picker
// rather than guessing — including when it is already the live scope, which is how you
// change who is in it. Nothing is applied until the sheet's own button is pressed, and that
// button is disabled while nobody is picked: with an empty pick "Our Stats" would silently
// be My Stats under the other word, which is exactly the class of defect 0280 existed to
// end.
//
// WHAT THIS CONTROL USED TO SAY, AND WHY NONE OF IT SURVIVED:
//
//   Anyone      gone outright. It only ever meant "everyone in this household", and there
//               is no household. It was also the DEFAULT, which is how /insights came to
//               report 56 trips while Settings ▸ Stats reported 17 — see migration 0280.
//   Together    it did not name who, and it stopped being true at three people.
//   All / Any   the operator is gone. Our Stats is the overlap, always.
//   a per-person pill    gone 2026-08-30 with this file — see above.
import { useState } from 'react';
import type { PersonContact } from '../lib/memoryPeople';
import {
  MY_STATS,
  OUR_STATS,
  isOurStats,
  myStats,
  othersInScope,
  ourStats,
  scopeSentence,
  type PeopleSelection,
} from '../lib/statsScope';

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
  // The picker's working copy. Nothing here reaches the numbers until it is applied, so
  // ticking a name cannot make the map redraw four times on the way to what you meant.
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  // With nobody but yourself recorded there is only My Stats, and a control with one
  // answer is a control you have to read for no reason.
  if (!me || others.length === 0) return null;

  const ours = isOurStats(value, people);

  const openPicker = () => {
    setDraft(othersInScope(value, people).map((p) => p.id));
    setPicking(true);
  };
  const applyPick = () => {
    const next = ourStats(people, draft);
    if (next) onChange(next);
    setPicking(false);
  };

  return (
    <>
      {/* KEEPS `person-filter` as well as its own class on purpose: every rule that
          positions this control, restyles it on a phone and hides it behind an open card is
          written against that name, and renaming it would quietly drop all of them. */}
      <div className={`people-filter ${inline ? 'people-filter-inline' : 'person-filter'}`}>
        <button
          className={ours ? '' : 'on'}
          onClick={() => {
            const next = myStats(people);
            if (next) onChange(next);
          }}
          title="Every card you are tagged on, on your own or not"
        >
          {MY_STATS}
        </button>

        <button
          className={ours ? 'on' : ''}
          onClick={openPicker}
          aria-haspopup="dialog"
          aria-expanded={picking}
          // WHAT THE SECOND SCOPE COSTS, said out loud. An intersection can only ever make
          // the number smaller, and a control that silently shrinks a total looks broken.
          title={
            ours
              ? `${scopeSentence(value, people)} Press to change who.`
              : 'Pick the people to count the overlap with'
          }
        >
          {OUR_STATS}
        </button>
      </div>

      {picking && (
        <div
          className="scope-picker-backdrop"
          role="presentation"
          onClick={() => setPicking(false)}
        >
          <div
            className="scope-picker"
            role="dialog"
            aria-modal="true"
            aria-label={`Who is in ${OUR_STATS}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scope-picker-head">Who is in {OUR_STATS}?</div>
            <p className="label scope-picker-note">
              {OUR_STATS} counts only the cards you and everyone you pick here are all tagged on.
              Each name you add can only make the number smaller.
            </p>
            <div className="scope-picker-list">
              {others.map((p) => {
                const on = draft.includes(p.id);
                return (
                  <button
                    key={p.id}
                    className={`scope-pick ${on ? 'on' : ''}`}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() =>
                      setDraft((d) => (on ? d.filter((x) => x !== p.id) : [...d, p.id]))
                    }
                  >
                    <span className="scope-pick-name">{p.display_name}</span>
                    <span className="scope-pick-tick" aria-hidden>
                      {on ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="scope-picker-actions">
              <button onClick={() => setPicking(false)}>Cancel</button>
              <button className="primary" disabled={draft.length === 0} onClick={applyPick}>
                Show {OUR_STATS}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
