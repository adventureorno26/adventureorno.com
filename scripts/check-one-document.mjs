// ONE DOCUMENT. The build fails if a second planning document reappears.
//
// Erica, 2026-08-11: "it is now the SINGLE source of truth and any future changes and
// instructions should be added there, never create a new MD."
// Erica, 2026-08-28: "fix EVERY fucking markdown file so you stop doing shit I dont want."
//
// WHY THIS IS A SCRIPT AND NOT A SENTENCE. The competing documents were deleted from git
// on 2026-08-11 — and on 2026-08-28 every one of them was still sitting on the disk,
// because OneDrive restores what git removes. README.md alone has been deleted twice; the
// second commit is literally titled "Delete README.md again — OneDrive and the auto-save
// put it back". So any session, or any other tool, that read the folder found a dozen
// plans contradicting STATE.md, and followed whichever it happened to open.
//
// A rule that lives in prose cannot fail a build. This one can.
//
// Usage: node scripts/check-one-document.mjs
import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// The only markdown this repository may contain, and why each one is allowed.
const ALLOWED = new Map([
  ['CLAUDE.md', 'the pointer Claude Code loads automatically; it points at STATE.md'],
  ['docs/STATE.md', 'THE document — the plan, the model, the rules, the history'],
]);

// Directories that are not ours to police: dependencies, build output, generated test
// artifacts, and the data-recovery manifests written beside a snapshot before a deletion.
// `.claude` holds agent worktrees — each is a full checkout of this repo, so each carries
// its own CLAUDE.md and docs/STATE.md. Walking into them reports six phantom "second
// planning documents" that are really one file seen four times. They are ephemeral working
// copies, never committed (see .gitignore), and the real STATE.md is still checked here.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'test-results',
  '.wrangler',
  '.backup-work',
  '.claude',
]);
const ALLOWED_PATTERNS = [
  // A snapshot MANIFEST records what was captured before a destructive cleanup, so it can
  // be restored. It is evidence, not a plan, and it must never be swept up with the docs.
  /^supabase\/snapshots\/[^/]+\/MANIFEST\.md$/,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue; // a symlink pointing nowhere, or a file removed mid-walk
    }
    if (s.isDirectory()) walk(p, out);
    else if (entry.toLowerCase().endsWith('.md')) out.push(p.split(sep).join('/'));
  }
  return out;
}

const found = walk('.').map((p) => p.replace(/^\.\//, ''));
const offenders = found.filter(
  (p) => !ALLOWED.has(p) && !ALLOWED_PATTERNS.some((re) => re.test(p)),
);

if (offenders.length) {
  console.error(
    `\nThis repository holds ONE planning document, and ${offenders.length} other markdown ` +
      `file${offenders.length === 1 ? '' : 's'} ${offenders.length === 1 ? 'is' : 'are'} present:\n` +
      offenders.map((p) => `  - ${p}`).join('\n') +
      '\n\nPut the content in docs/STATE.md and delete the file. If a new one genuinely has to' +
      '\nexist, add it to ALLOWED in this script WITH A REASON — that is a decision somebody' +
      '\nmakes on purpose, which is the whole point.' +
      '\n\nIf you did not create these: OneDrive restores files that git deletes. Removing them' +
      '\nfrom disk again is enough; this check is what tells you they came back.\n',
  );
  process.exit(1);
}

console.log(
  `One-document check passed: ${found.length} markdown file(s), all of them accounted for.`,
);
