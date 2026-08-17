import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

// The app's single persistent primary navigation. Text-only (no icons, per
// Erica's standing preference), styled as a bottom-center glass pill to match
// the existing back-bar / stats-bar language. Rendered globally in App.tsx.
//
// FOUR destinations: Map (home), Places (the list), Add and Timeline.
//
// ⚠️ REVISED 2026-08-11 (docs/STATE.md). ADD opens a FILLABLE CARD — not a
// chooser, not a sheet asking what you are adding. Import photos, Sort photos
// and Import activities live in SETTINGS now. Settings itself is moving out of
// the nav to the gear wheel, leaving four tabs: Map / Places / Add / Timeline.

/** The Add sheet opens OVER the map, so while it is open the map is not the
 *  current tab — Add is. */
const addOpen = (search: string) => new URLSearchParams(search).get('add') === '1';

const TABS: { to: string; label: string; match?: (path: string, search: string) => boolean }[] = [
  { to: '/', label: 'Map', match: (p, s) => (p === '/' || p.startsWith('/place/')) && !addOpen(s) },
  { to: '/places', label: 'Places', match: (p) => p === '/places' || p === '/places/edit' },
  // Add is a sheet, not a page, so it highlights on its query flag rather than a path.
  // ADD OPENS THE BLANK CARD, not a page (Erica, 2026-08-15). /add still exists — Settings
  // links to it for importing and sorting — but the TAB is for adding one thing.
  {
    to: '/?add=1',
    label: 'Add',
    match: (p, s) => p === '/add' || p === '/photos/sort' || addOpen(s),
  },
  { to: '/timeline', label: 'Timeline' },
];

export default function PrimaryNav() {
  const { session, profile } = useAuth();
  const { pathname, search } = useLocation();

  // Only for signed-in members, and never over the login screen.
  if (!session || !profile || pathname === '/login') return null;
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return null;

  // NOT ON SETTINGS (Erica, 2026-08-17: "map places add timeline should not appear on the
  // settings page"). Settings is a place you went INTO from the gear, and it has its own
  // back-bar out — a destination bar underneath it offers to leave a screen you are still
  // reading, and on a phone it sits over the bottom of a long page. The same reasoning
  // already removed the stats bar and the gear from Places.

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
