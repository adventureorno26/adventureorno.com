// EVERY POINTER TO A DOC MUST POINT AT A DOC THAT EXISTS.
//
// On 2026-08-11 every planning document except docs/STATE.md was deleted, on purpose:
// "it is now the SINGLE source of truth and any future changes and instructions should
// be added there, never create a new MD." The documents went. The POINTERS TO THEM did
// not — nine of them, in files that are still shipped and still read:
//
//   app/src/lib/types.ts            "See docs/SCHEMA.md."
//   workers/photo-gateway/wrangler.toml  "see docs/MANUAL-SETUP.md §5"
//   scripts/export-data.sh          "see docs/backup-restore.md"
//   …and six more
//
// A comment that sends you to a file that does not exist is worse than no comment: it
// reads as authoritative, and the reader who follows it concludes the repository is
// missing something rather than that the note is stale. This is the same failure as the
// export's hand-maintained table list — something true when written, never re-checked.
//
// So it is checked now. Add a reference to a doc that does not exist and this fails.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");

// Only files a person actually reads and maintains. node_modules is somebody else's
// prose, and migrations are a HISTORICAL RECORD — 0136 said docs/SCHEMA.md because
// that is what it said the day it was applied, and rewriting an applied migration to
// look tidier is editing the past.
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  ".wrangler",
  "migrations",
  "coverage",
  // `.claude` holds agent worktrees, each a full checkout of this repo — including a copy
  // of THIS FILE, whose own fixtures name deleted documents. Walking into them reports
  // this test's examples as real pointers and fails on itself. Added 2026-08-30, when
  // three parallel worktrees turned that into eight phantom findings.
  ".claude",
]);
const EXT = /\.(ts|tsx|js|mjs|cjs|sh|toml|json|yml|yaml|css|sql|md)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(entry)) out.push(full);
  }
  return out;
}

const REFERENCE = /docs\/[A-Za-z0-9._-]+\.md/g;

// A line may name a deleted document ON PURPOSE — "Do not recreate /docs/decisions.md"
// is an instruction, and the whole point of it is that the file is not there. What must
// not survive is a line that sends you somewhere as if you could arrive.
const KNOWINGLY_GONE =
  /do not recreate|deleted|does not exist|no longer|was never|is gone/i;

/** This file names dead documents as its own examples; it would otherwise fail itself. */
const SELF = import.meta.filename;

describe("the docs a file points at exist", () => {
  it("has no pointer to a deleted document", () => {
    const dead = [];
    for (const file of walk(REPO)) {
      if (file === SELF) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (KNOWINGLY_GONE.test(line)) continue;
        for (const ref of line.match(REFERENCE) ?? []) {
          if (!existsSync(join(REPO, ref))) {
            dead.push(`${file.slice(REPO.length + 1)} → ${ref}`);
          }
        }
      }
    }
    expect(
      dead,
      "these send a reader to a document that does not exist — repoint them at " +
        "docs/STATE.md and the section that now holds the content",
    ).toEqual([]);
  });

  it("still finds the pointers, so an empty pass cannot be mistaken for a clean one", () => {
    // The check above passes trivially if the walk finds nothing — a broken SKIP list
    // or a wrong root would look exactly like success. It must see real references.
    const found = walk(REPO)
      .filter((f) => f !== SELF)
      .flatMap((f) => readFileSync(f, "utf8").match(REFERENCE) ?? []);
    expect(
      found.length,
      "the walk found no docs/*.md references at all",
    ).toBeGreaterThan(5);
  });
});
