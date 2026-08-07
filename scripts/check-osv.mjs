// Hard-gate OSV-Scanner findings.
//
// Replaces the old `osv-scanner ... || true`, which could never fail and therefore
// produced a false green (COMPLETION-PLAN Phase 1, blocker 3).
//
// Policy:
//   * A finding on a PRODUCTION-reachable package fails unless an unexpired
//     exception names both the advisory AND that package. Production risk must be
//     accepted deliberately and narrowly.
//   * A finding on a dev/build-only package fails unless an unexpired exception
//     names the advisory. These ship to nobody, but they are still acknowledged
//     with an owner and an expiry so the list cannot rot silently.
//   * Any expired exception fails, whether or not it still matches a finding.
//   * A malformed exception (missing owner/reason/expires) fails.
//   * Unused exceptions are reported but do not fail — they mean a dependency was
//     upgraded, which is good news, not a build break.
//
// Usage: node scripts/check-osv.mjs [path-to-osv-scanner]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scanner = process.argv[2] || 'osv-scanner';
const policy = JSON.parse(readFileSync(new URL('../security/osv-exceptions.json', import.meta.url)));

// --- 1. Which packages actually ship? ---------------------------------------
const tree = spawnSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
let productionPackages;
try {
  const root = JSON.parse(tree.stdout);
  productionPackages = new Set();
  const walk = (node) => {
    for (const [name, child] of Object.entries(node.dependencies || {})) {
      if (productionPackages.has(name)) continue;
      productionPackages.add(name);
      walk(child);
    }
  };
  walk(root);
} catch {
  console.error('Could not resolve the production dependency tree; refusing to pass.');
  process.exit(1);
}

// --- 2. Scan ------------------------------------------------------------------
const scan = spawnSync(scanner, ['scan', 'source', '--recursive', '.', '--format', 'json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
// OSV exits non-zero when it finds anything, so status alone is not an error
// signal — but unparseable output is.
let report;
try {
  report = JSON.parse(scan.stdout);
} catch {
  console.error('OSV-Scanner produced no parseable JSON; refusing to pass.');
  console.error(scan.stderr || scan.stdout || '(no output)');
  process.exit(1);
}

/** advisoryId -> Set(packageName) */
const findings = new Map();
for (const result of report.results || []) {
  for (const pkg of result.packages || []) {
    const name = pkg.package?.name;
    for (const vuln of pkg.vulnerabilities || []) {
      if (!findings.has(vuln.id)) findings.set(vuln.id, new Set());
      findings.get(vuln.id).add(name);
    }
  }
}

// --- 3. Validate the exception list ------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const exceptions = new Map();
const problems = [];

for (const exception of policy.exceptions || []) {
  const { id, owner, reason, expires, packages, scope } = exception;
  if (!id || !owner || !reason || !expires) {
    problems.push(`Malformed exception ${id || '(no id)'}: id, owner, reason and expires are required.`);
    continue;
  }
  if (expires < today) {
    problems.push(`Exception ${id} expired on ${expires} (owner: ${owner}). Re-review or upgrade.`);
    continue;
  }
  if (scope === 'production' && (!Array.isArray(packages) || packages.length === 0)) {
    problems.push(`Exception ${id} is scoped to production and must list the accepted packages.`);
    continue;
  }
  exceptions.set(id, exception);
}

// --- 4. Enforce ---------------------------------------------------------------
let productionFindings = 0;
let devFindings = 0;

for (const [id, packageNames] of findings) {
  const hitsProduction = [...packageNames].filter((n) => productionPackages.has(n));
  const exception = exceptions.get(id);

  if (hitsProduction.length) {
    productionFindings += 1;
    if (!exception) {
      problems.push(
        `${id} affects PRODUCTION package(s) ${hitsProduction.join(', ')} and has no accepted exception.`,
      );
      continue;
    }
    if (exception.scope !== 'production') {
      problems.push(
        `${id} affects PRODUCTION package(s) ${hitsProduction.join(', ')} but its exception is scoped "${exception.scope}".`,
      );
      continue;
    }
    const notAccepted = hitsProduction.filter((n) => !exception.packages.includes(n));
    if (notAccepted.length) {
      problems.push(`${id} exception does not cover production package(s) ${notAccepted.join(', ')}.`);
    }
  } else {
    devFindings += 1;
    if (!exception) {
      problems.push(
        `${id} affects dev/build package(s) ${[...packageNames].join(', ')} and has no accepted exception.`,
      );
    }
  }
}

const unused = [...exceptions.keys()].filter((id) => !findings.has(id));
if (unused.length) {
  console.log(`Note: ${unused.length} exception(s) no longer match any finding (safe to delete): ${unused.join(', ')}`);
}

if (problems.length) {
  console.error(`OSV gate FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `OSV gate passed: ${findings.size} advisory/advisories (${productionFindings} production-reachable, ` +
    `${devFindings} dev/build-only), all covered by reviewed unexpired exceptions.`,
);
