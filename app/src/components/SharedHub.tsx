// The apps we both use — one-tap launch. No credentials stored; each opens where
// you sign in normally (a shared household login works there).
const APPS: { name: string; url: string }[] = [
  { name: 'Wegmans', url: 'https://www.wegmans.com/' },
  { name: 'Total Wine', url: 'https://www.totalwine.com/' },
  { name: 'CellarTracker', url: 'https://www.cellartracker.com/' },
  { name: 'Amazon Music', url: 'https://music.amazon.com/' },
  { name: 'Spotify', url: 'https://open.spotify.com/' },
  { name: 'Audible', url: 'https://www.audible.com/' },
  { name: 'Netflix', url: 'https://www.netflix.com/' },
  { name: 'AnyList', url: 'https://www.anylist.com/' },
];

export default function SharedHub() {
  return (
    <div className="shared-hub">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Our apps</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Tap to open — sign in there with your shared household login.
        </p>
        <div className="app-launcher">
          {APPS.map((a) => (
            <a key={a.name} className="app-tile" href={a.url} target="_blank" rel="noreferrer">
              {a.name}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
