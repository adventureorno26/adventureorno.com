// ONE credit for the whole page, wherever OpenStreetMap data is shown.
//
// Erica, 2026-08-17, asked for this "once at the page level" rather than a control bolted
// to every map. The OSMF guideline allows exactly that: the credit may sit in a corner of
// the map OR adjacent to it, so one line on the page covers every map on that page. It is
// the quieter arrangement as well as the simpler one.
//
// WHAT IT IS FOR. Maps built from OpenStreetMap data need a credit because the DATA is
// ODbL — owning the tiles changed who serves the bytes, not who owns them. Some maps carry
// MapLibre's own attribution control; the small ones do not, because a control inside a
// 120px map is most of the map. Those are what this covers.
//
// THE FLOOR IT HAS TO CLEAR, and none of it is negotiable: legible WITHOUT interaction —
// not behind a tap, not faded — and a route to the origin and licence, which is why the
// text is a link rather than bare words.
//
// `optional` prop deliberately does not exist. A credit that can be switched off is a
// credit that will be, on the screen nobody re-checked.
export default function OsmCredit({ className = '' }: { className?: string }) {
  return (
    <p className={`osm-credit ${className}`.trim()}>
      Map data from{' '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
    </p>
  );
}
