// THE "WHO WAS THERE" CONTROL — one picker, on all seven surfaces.
//
// Erica, 2026-08-30: *"yes, people picker."* You tag whoever was there, by name. Nobody
// ticked means it was just you. What the words used to be, and why none of them survived,
// is recorded in lib/participants.
//
// IT IS THE SHEET PR #187 BUILT, not a second one. The scope picker (`components/
// PeopleFilter.tsx`) put a bottom sheet of tickable names behind a button, worked out on a
// real phone that it has to clear the floating nav (`--pnav-clearance`), and its rules are
// written against `.scope-picker*`. This renders that markup, so the two pickers cannot
// drift apart on a phone. They are not one COMPONENT because they answer different
// questions — a scope is "whose numbers are these" and this is "who was on this card" —
// and a component that took a flag to be either would be how the two questions started
// looking interchangeable again, which is the defect migration 0280 exists to end.
//
// NOTHING IS APPLIED UNTIL SAVE. The draft lives here; the surface hears one `onChange`
// with the finished set. Ticking a name cannot fire an RPC per tap on the way to what you
// meant, and Cancel genuinely cancels.
//
// CAPACITY IS NOT DECORATION. `set_place_solo` and `set_activity_solo` take ONE profile id;
// only `set_visit_participants` takes a list. A surface writing a place or an outing passes
// `capacity="one"` and the sheet ticks one name at a time and says so. The alternative —
// looking multi-select and keeping the first name — is a control that lies about what it
// saved.
import { useState } from 'react';
import { whoLabel, type WhoCapacity, type WhoPerson } from '../lib/participants';

const NOTE: Record<WhoCapacity, string> = {
  many: 'Tick everyone who was there. Nobody ticked means it was just you.',
  one: 'This record holds one name, so ticking a name clears the last. Nobody ticked means it was just you.',
};

export default function WhoPicker({
  people,
  meId,
  value,
  onChange,
  capacity = 'many',
  heading = 'Who was there?',
  note,
  emptyLabel,
  saveLabel = 'Save',
  disabled = false,
  className = '',
}: {
  /** Everyone who can be tagged, in the order they should be listed. */
  people: WhoPerson[];
  meId: string | null | undefined;
  /** Profile ids of everyone on this card. Empty means it was just you. */
  value: string[];
  onChange: (ids: string[]) => void;
  capacity?: WhoCapacity;
  heading?: string;
  note?: string;
  /** What the button reads with nothing picked. Attribution leaves this unset, because
   *  empty already MEANS something there ("just you"); a filter passes its own word,
   *  because empty means "not narrowed" and that is not a person at all. */
  emptyLabel?: string;
  saveLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const label = value.length === 0 && emptyLabel ? emptyLabel : whoLabel(value, people, meId);

  // A ONE-NAME RECORD THAT ALREADY HOLDS TWO. It happens: a place whose visits were
  // attributed before this control existed can carry both of us, and `set_place_solo`
  // has one slot to write it back into. The sheet opens showing the truth and refuses to
  // save until a single name is picked — it does not quietly keep the first one, which
  // would be the picker reporting a save it did not make.
  const overCapacity = capacity === 'one' && draft.length > 1;

  const toggle = (id: string) =>
    setDraft((d) =>
      d.includes(id)
        ? d.filter((x) => x !== id)
        : // One name at a time REPLACES rather than refusing: a control that ignores a tap
          // reads as broken, and there is no second slot to put the name in.
          capacity === 'one'
          ? [id]
          : [...d, id],
    );

  return (
    <>
      <button
        type="button"
        className={`who-picker-btn ${className}`.trim()}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={heading}
        title={heading}
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      >
        {label}
      </button>

      {open && (
        <div className="scope-picker-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="scope-picker who-picker"
            role="dialog"
            aria-modal="true"
            aria-label={heading}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="scope-picker-head">{heading}</div>
            <p className="label scope-picker-note">
              {overCapacity
                ? 'This record holds one name and currently carries more than one. Pick the one it belongs to.'
                : (note ?? NOTE[capacity])}
            </p>
            <div className="scope-picker-list">
              {people.map((p) => {
                const on = draft.includes(p.id);
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={`scope-pick ${on ? 'on' : ''}`}
                    role={capacity === 'one' ? 'radio' : 'checkbox'}
                    aria-checked={on}
                    onClick={() => toggle(p.id)}
                  >
                    {/* YOUR OWN ROW IS "You". Everyone else is the name on their record —
                        never a word standing in for a person, which is what the control
                        this replaced did and why it could name the wrong one. */}
                    <span className="scope-pick-name">
                      {p.id === meId ? 'You' : (p.display_name?.trim() ?? '')}
                    </span>
                    <span className="scope-pick-tick" aria-hidden>
                      {on ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="scope-picker-actions">
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={overCapacity}
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                {saveLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
