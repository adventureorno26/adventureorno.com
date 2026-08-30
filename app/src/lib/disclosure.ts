// ONE OPEN AT A TIME — the rule behind the stats dropdowns in Settings.
//
// WHAT THIS FIXES. Settings' Stats section had FOUR sibling `<details>` — Stats, Cities
// and states, National Parks, Peaks & climbing — each wrapping a whole card, each
// independent, and none of them carrying an `open` attribute or any JS. Erica,
// 2026-08-29: *"The dropdowns under stats in settings need work. They don't disappear
// and are redundant."*
//
// THE NATIVE TOGGLE WAS NEVER BROKEN. Clicking a summary opened and closed it correctly
// in both Chromium and WebKit, on desktop and phone widths — verified against the real
// stylesheet before anything here was written. What was broken is that `.stats-dropdown
// > summary` hid the native disclosure marker (`list-style: none` plus
// `::-webkit-details-marker { display: none }`) and never supplied a replacement, so the
// summary rendered IDENTICALLY whether the panel was open or shut. It is the only
// disclosure in the app that does this — `.visits-details`, `.spots-details` and
// `.spot-cat` all flip a ▸ to a ▾. With no marker there is nothing saying the bare word
// "Stats" is a control, and nothing saying a panel you opened can be shut again; open
// all four and the section is a wall that never goes back. That is "they don't
// disappear", and the marker is put back in index.css alongside this.
//
// This module is the second half: the panels are a GROUP, so opening one closes the
// last. You cannot end up with four open at once, which is the state she was describing.
// The state lives here, as plain values, so the rule can be tested without a DOM.

/** Which panel in a group is open. `null` means all of them are shut. */
export type OpenPanel = string | null;

/**
 * The group's next state when `key`'s summary is activated.
 *
 * Clicking the open panel shuts it (a disclosure you cannot close is the bug);
 * clicking any other panel opens it and shuts whatever was open before.
 */
export function nextOpenPanel(current: OpenPanel, key: string): OpenPanel {
  return current === key ? null : key;
}

/** Whether `key` is the panel currently open. */
export function panelIsOpen(current: OpenPanel, key: string): boolean {
  return current === key;
}
