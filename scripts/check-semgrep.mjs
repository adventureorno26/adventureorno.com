// Hard-gate Semgrep findings over first-party source.
//
// Replaces the old `semgrep ... || true`, which could never fail (COMPLETION-PLAN
// Phase 1, blocker 3).
//
// Policy:
//   * Any ERROR/WARNING finding fails unless an unexpired, owned exception names
//     that rule AND that file.
//   * INFO findings fail too. There is exactly one today and keeping it in the
//     list means a second one gets a human decision instead of scrolling past.
//   * Any expired or malformed exception fails.
//   * A scanned path that does not exist fails. The previous CI invocation passed a
//     `src` directory that does not exist at the repo root; combined with `|| true`
//     that silently scanned less than it claimed.
//   * A file Semgrep cannot fully parse is only PARTLY scanned, which is a silent
//     coverage hole. Known parser limitations are recorded; a NEW unparseable file
//     fails.
//
// Usage: node scripts/check-semgrep.mjs <semgrep-binary> <path...>
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const [, , binary = 'semgrep', ...paths] = process.argv;
if (!paths.length) {
  console.error('Usage: node scripts/check-semgrep.mjs <semgrep-binary> <path...>');
  process.exit(1);
}

const policy = JSON.parse(
  readFileSync(new URL('../security/semgrep-exceptions.json', import.meta.url)),
);

// --- Scanned paths must exist -------------------------------------------------
const missing = paths.filter((p) => !existsSync(p));
if (missing.length) {
  console.error(
    `Semgrep gate FAILED: scan path(s) do not exist: ${missing.join(', ')}. ` +
      'A non-existent path means less source was scanned than the job claims.',
  );
  process.exit(1);
}

const scan = spawnSync(binary, ['scan', '--config=auto', '--quiet', '--json', ...paths], {
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(scan.stdout);
} catch {
  console.error('Semgrep produced no parseable JSON; refusing to pass.');
  console.error(scan.stderr || scan.stdout || '(no output)');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const problems = [];

// --- Validate exceptions ------------------------------------------------------
/** `${rule}::${file}` -> exception */
const findingExceptions = new Map();
for (const exception of policy.findings || []) {
  const { rule, file, owner, reason, expires } = exception;
  if (!rule || !file || !owner || !reason || !expires) {
    problems.push(`Malformed finding exception (${rule || '?'}): rule, file, owner, reason and expires are required.`);
    continue;
  }
  if (expires < today) {
    problems.push(`Semgrep exception ${rule} @ ${file} expired on ${expires} (owner: ${owner}).`);
    continue;
  }
  findingExceptions.set(`${rule}::${file}`, exception);
}

const knownUnparseable = new Set();
for (const entry of policy.parserLimitations || []) {
  const { file, owner, reason, expires } = entry;
  if (!file || !owner || !reason || !expires) {
    problems.push(`Malformed parserLimitations entry (${file || '?'}): file, owner, reason and expires are required.`);
    continue;
  }
  if (expires < today) {
    problems.push(`Semgrep parser-limitation entry for ${file} expired on ${expires} (owner: ${owner}).`);
    continue;
  }
  knownUnparseable.add(file);
}

// --- Enforce findings ---------------------------------------------------------
const bySeverity = { ERROR: 0, WARNING: 0, INFO: 0 };
for (const result of report.results || []) {
  const rule = result.check_id.split('.').pop();
  const file = result.path;
  const severity = (result.extra?.severity || 'INFO').toUpperCase();
  bySeverity[severity] = (bySeverity[severity] || 0) + 1;

  if (!findingExceptions.has(`${rule}::${file}`)) {
    problems.push(
      `${severity} ${rule} at ${file}:${result.start?.line} has no accepted exception — ` +
        `${(result.extra?.message || '').trim().split('\n')[0].slice(0, 120)}`,
    );
  }
}

// --- Enforce parse coverage ---------------------------------------------------
const unparseable = new Set();
for (const err of report.errors || []) {
  const type = Array.isArray(err.type) ? err.type[0] : err.type;
  if (typeof type === 'string' && /Parsing/i.test(type)) {
    const spans = Array.isArray(err.type) ? err.type[1] || [] : [];
    for (const span of spans) if (span?.path) unparseable.add(span.path);
    if (err.path) unparseable.add(err.path);
  }
}
for (const file of unparseable) {
  if (!knownUnparseable.has(file)) {
    problems.push(
      `${file} could not be fully parsed by Semgrep, so it is only PARTLY scanned. ` +
        'Record it under parserLimitations with an owner and expiry, or fix the construct.',
    );
  }
}

if (problems.length) {
  console.error(`Semgrep gate FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `Semgrep gate passed over ${paths.join(', ')}: ` +
    `${bySeverity.ERROR} error / ${bySeverity.WARNING} warning / ${bySeverity.INFO} info finding(s), ` +
    `${unparseable.size} known parser limitation(s), all reviewed and unexpired.`,
);
