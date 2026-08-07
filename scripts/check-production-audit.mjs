// Hard-gate production dependency advisories while allowing only reviewed,
// unexpired, non-applicable exceptions from security/audit-exceptions.json.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync(new URL('../security/audit-exceptions.json', import.meta.url)));
const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error(audit.stderr || audit.stdout || 'npm audit returned no JSON.');
  process.exit(1);
}
if (report.error || !report.metadata?.vulnerabilities) {
  console.error(`npm audit failed: ${JSON.stringify(report.error || report)}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const exceptions = new Map();
for (const exception of policy.exceptions || []) {
  if (!exception.owner || !exception.reason || !exception.expires) {
    console.error(`Malformed audit exception ${exception.advisory}: owner, reason, and expires are required.`);
    process.exit(1);
  }
  if (exception.expires < today) {
    console.error(`Audit exception ${exception.advisory} expired on ${exception.expires}.`);
    process.exit(1);
  }
  exceptions.set(Number(exception.advisory), exception);
}

const advisories = new Map();
const affectedPackages = new Set(Object.keys(report.vulnerabilities || {}));
for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  for (const via of vulnerability.via || []) {
    if (typeof via === 'object' && via.source) advisories.set(Number(via.source), via);
  }
}

const unaccepted = [];
for (const [id, advisory] of advisories) {
  const exception = exceptions.get(id);
  if (!exception) {
    unaccepted.push(`${id} ${advisory.title}`);
    continue;
  }
  for (const packageName of affectedPackages) {
    if (!exception.packages.includes(packageName)) {
      unaccepted.push(`${id} does not allow affected package ${packageName}`);
    }
  }
}

if (unaccepted.length) {
  console.error(`Unaccepted production dependency findings:\n- ${unaccepted.join('\n- ')}`);
  process.exit(1);
}

if (report.metadata.vulnerabilities.critical > 0 && advisories.size === 0) {
  console.error('Critical production findings were reported without parseable advisory details.');
  process.exit(1);
}

console.log(
  `Production audit gate passed: ${affectedPackages.size} affected package(s), ${advisories.size} reviewed unexpired exception(s).`,
);
