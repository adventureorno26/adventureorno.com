import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

// The app's single persistent primary navigation. Text-only (no icons, per
// Erica's standing preference), styled as a bottom-center glass pill to match
// the existing back-bar / stats-bar language. Rendered globally in App.tsx.
//
// FOUR destinations: Map (home), Add, Insights and Settings.
//
// ⚠️ REVISED 2026-08-22 to the approved navigation: `Map | Add | Insights | Settings`.
// Places and Timeline are no longer destinations of their own — they are TABS INSIDE
// Insights, sharing one people/time/category scope with an Overview, which is the whole
// reason to put them together. /places and /timeline still work and redirect there.
//
// AND SETTINGS COMES BACK INTO THE NAV, which reverses an instruction rather than ignoring
// one. Erica, 2026-08-17: "map places add timeline should not appear on the settings page" —
// and she was right, because none of those four WAS Settings, so the bar offered only ways
// to leave a screen she was still reading. Now Settings is one of the four, so the bar says
// where she is instead. The approved contract calls this navigation persistent; the older
// instruction was about a bar that did not include the page it sat on.
//
// ⚠️ EARLIER, 2026-08-11 (docs/STATE.md). ADD opens a FILLABLE CARD — not a chooser, not
// a sheet asking what you are adding. Import photos, Sort photos and Import activities live
// in SETTINGS. Unchanged: Add introduces information only.

/** The Add sheet opens OVER the map, so while it is open the map is not the
 *  current tab — Add is. */
const addOpen = (search: string) => new URLSearchParams(search).get('add') === '1';

const TABS: { to: string; label: string; match?: (path: string, search: string) => boolean }[] = [
  { to: '/', label: 'Map', match: (p, s) => (p === '/' || p.startsWith('/place/')) && !addOpen(s) },
  // Add is a sheet, not a page, so it highlights on its query flag rather than a path.
  // ADD OPENS THE BLANK CARD, not a page (Erica, 2026-08-15). /add still exists — Settings
  // links to it for importing and sorting — but the TAB is for adding one thing.
  {
    to: '/?add=1',
    label: 'Add',
    match: (p, s) => p === '/add' || p === '/photos/sort' || addOpen(s),
  },
  {
    to: '/insights',
    label: 'Insights',
    // The two screens that used to be tabs of their own still light Insights, whether they
    // are reached through it or through a link somebody saved months ago.
    match: (p) => p === '/insights' || p === '/places' || p === '/places/edit' || p === '/timeline',
  },
  { to: '/settings', label: 'Settings', match: (p) => p.startsWith('/settings') },
];

export default function PrimaryNav() {
  const { session, profile } = useAuth();
  const { pathname, search } = useLocation();

  // Only for signed-in members, and never over the login screen.
  if (!session || !profile || pathname === '/login') return null;

  // IT DOES SHOW ON SETTINGS NOW, because Settings is one of the four. The rule it replaces
  // said otherwise for a good reason — a bar of four places to go, none of them the page you
  // are on, is only an invitation to leave — and that reason stops applying the moment the
  // page you are on is one of them.

  // FOUR tabs, and the Add pill says "Add" — nothing else.
  //
  // It used to read "Add 3" (Erica, 2026-08-16: "It should just say Add"). The pending
  // review count rode on the label because the Inbox tab was removed and the number had
  // to go somewhere. A destination is a place you are going; a queue length is not part
  // of its name, and one that changes under you makes the pill's width jump.
  //
  // Nothing is lost by removing it: /add still heads its queue "To review · N", which is
  // the screen that can actually do something about the number. That also drops a
  // fetchInboxCounts() that ran on EVERY navigation just to render one digit.

  return (
    <nav className="primary-nav" aria-label="Primary">
      {TABS.map((t) => {
        const active = t.match ? t.match(pathname, search) : pathname === t.to && !addOpen(search);
        return (
          <NavLink
            key={t.to}
            to={t.to}
            // The FUNCTION form on purpose. With a string, NavLink appends its own
            // "active" class from route matching — and "/?add=1" matches the pathname
            // "/", so Add lit up permanently on the map. The faint old highlight hid
            // it; the bright one does not. Here the tab's own `match` is the only
            // thing that decides.
            className={() => `pnav-tab${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
