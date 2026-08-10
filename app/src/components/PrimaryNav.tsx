import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { fetchInboxCounts } from '../lib/inbox';

// The app's single persistent primary navigation. Text-only (no icons, per
// Erica's standing preference), styled as a bottom-center glass pill to match
// the existing back-bar / stats-bar language. Rendered globally in App.tsx.
//
// Five destinations: Map (home), Places (the list — previously unreachable),
// Add, Timeline, and More (settings + Manage-data tools).
//
// Add is not a page. It opens the ONE add sheet over the map (?add=1), the same
// sheet the map's "+ Add" button opens — it used to be a separate five-step
// wizard at /add that could not add photos or import from Google Photos, which
// is how the app ended up with two different answers to "add something".

/** The Add sheet opens OVER the map, so while it is open the map is not the
 *  current tab — Add is. */
const addOpen = (search: string) => new URLSearchParams(search).get('add') === '1';

const TABS: { to: string; label: string; match?: (path: string, search: string) => boolean }[] = [
  { to: '/', label: 'Map', match: (p, s) => (p === '/' || p.startsWith('/place/')) && !addOpen(s) },
  { to: '/places', label: 'Places', match: (p) => p === '/places' || p === '/places/edit' },
  // Add is a sheet, not a page, so it highlights on its query flag rather than a path.
  { to: '/add', label: 'Add', match: (p, s) => p === '/add' || p === '/photos/sort' || addOpen(s) },
  { to: '/timeline', label: 'Timeline' },
  {
    to: '/settings',
    label: 'Settings',
    match: (p) => p === '/settings' || p.startsWith('/settings/'),
  },
];

export default function PrimaryNav() {
  const { session, profile } = useAuth();
  const { pathname, search } = useLocation();
  const [waiting, setWaiting] = useState(0);

  // The Inbox tab is PERMANENT. It used to appear only when something was waiting,
  // because six tabs did not fit a 320px phone — but that clipped the last tab at the
  // pill's edge ("half off the screen"), and it meant /inbox highlighted no tab at all
  // when the queue was empty. The tab sizing now fits six at every width we target
  // (measured 320-430px), so the count is the only thing that comes and goes.
  useEffect(() => {
    if (!session || !profile) return;
    let live = true;
    fetchInboxCounts()
      .then((c) => {
        if (live) setWaiting(c.cards ?? 0);
      })
      .catch(() => {
        /* the badge is a nicety; never let it break navigation */
      });
    return () => {
      live = false;
    };
  }, [session, profile, pathname]);

  // Only for signed-in members, and never over the login screen.
  if (!session || !profile || pathname === '/login') return null;

  // FIVE tabs. The Inbox tab is gone — adding and sorting both live behind Add, so
  // there is one door for getting things in and one (Places) for fixing what is there.
  // The pending count rides on Add instead of adding a sixth destination.
  const tabs: typeof TABS = TABS.map((t) =>
    t.label === 'Add' && waiting ? { ...t, label: `Add ${waiting}` } : t,
  );

  return (
    <nav className="primary-nav" aria-label="Primary">
      {tabs.map((t) => {
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
