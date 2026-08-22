// A link is not a button, and neither one goes inside the other.
//
// An audit on 2026-08-21 found fifteen places written as:
//
//     <Link to="/export"><button>Export &amp; backup</button></Link>
//
// which puts one interactive control inside another. The browser gets a link AND a button in
// the same box; the accessibility tree shows them nested; and which one a keyboard or a
// screen reader is addressing stops being obvious.
//
// They are all navigation, so the LINK is the right control and the button was only ever
// there for its styling. `a.as-button` gets that styling now, and the six base button rules
// name it alongside `button`.
//
// This is a source guard rather than an eslint rule because the shape is specific and the
// rule that would catch it (nested interactive elements across component boundaries) is not
// something a linter can see: `Link` is a component, and jsx-a11y cannot know it renders an
// anchor.
import { describe, expect, it } from 'vitest';

const RAW = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const NESTED = /<Link\b[^>]*>\s*<button\b/;
const NESTED_REVERSE = /<button\b[^>]*>\s*<Link\b/;

describe('one control per control', () => {
  it('no Link wraps a button', () => {
    const offenders = Object.entries(RAW)
      .filter(([, src]) => NESTED.test(src))
      .map(([path]) => path);
    expect(offenders, 'use <Link className="as-button"> instead').toEqual([]);
  });

  it('and no button wraps a Link either', () => {
    const offenders = Object.entries(RAW)
      .filter(([, src]) => NESTED_REVERSE.test(src))
      .map(([path]) => path);
    expect(offenders, 'a control inside a control, the other way round').toEqual([]);
  });

  it('and the replacement is actually in use', () => {
    // A guard that only forbids the old shape would pass just as happily on a codebase where
    // somebody deleted all fifteen links.
    const uses =
      Object.values(RAW)
        .join('\n')
        .match(/className="as-button[^"]*"/g) ?? [];
    expect(uses.length, 'nothing uses as-button — did the rewrite get reverted?').toBeGreaterThan(
      10,
    );
  });
});
