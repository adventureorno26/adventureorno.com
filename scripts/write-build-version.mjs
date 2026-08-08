import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stamps app/public/version.json so /version.json identifies exactly what is
// deployed. This runs as `prebuild`, so EVERY build carries it.
//
// It used to require BUILD_SHA and throw without it, and it was only ever invoked
// from CI. Production, meanwhile, is Direct-Upload and `deploy-production` skips, so
// every real deploy was a MANUAL `npm run build` — which never ran this script. The
// result: production served a version.json left over from an older build. It
// reported 502b8d26 while a completely different bundle was live, and both
// COMPLETION-PLAN.md and scripts/smoke-pages.mjs treat that file as proof of what is
// deployed. A stale stamp does not just fail to help, it actively misleads.
//
// So: prefer BUILD_SHA (CI passes the merge-candidate SHA, which git alone cannot
// know), and fall back to the local git HEAD. A build from a dirty tree is marked
// `dirty: true` rather than claiming to be a clean commit.

function fromGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let sha = process.env.BUILD_SHA;
let dirty = false;

if (sha) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error('BUILD_SHA must be a full 40-character Git commit SHA.');
  }
} else {
  try {
    sha = fromGit(['rev-parse', 'HEAD']);
    dirty = fromGit(['status', '--porcelain']).length > 0;
  } catch {
    throw new Error(
      'No BUILD_SHA and not a git checkout — cannot stamp the build. Set BUILD_SHA to a full 40-character commit SHA.',
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`git rev-parse HEAD did not return a commit SHA (got "${sha}").`);
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'app/public/version.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify({ sha, builtAt: new Date().toISOString(), dirty })}\n`);
console.log(`Prepared build provenance for ${sha}${dirty ? ' (dirty tree)' : ''}.`);
