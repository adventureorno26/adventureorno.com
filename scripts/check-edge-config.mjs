// Edge-function config-drift check (Prompt 3).
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/check-edge-config.mjs
//
// Compares each deployed Edge Function's verify_jwt against the declaration in
// supabase/config.toml ([functions.<name>] verify_jwt). Fails if any deployed
// function's verify_jwt differs, or if a deployed function isn't declared. This
// catches an accidental auth-behavior change (or a redeploy that silently flips a
// public callback to JWT-required, or vice-versa). Without the token it's a no-op
// so forks/PRs without the secret don't fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT_REF = 'aanfyhsjbtnqzphuoiem';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.log('SUPABASE_ACCESS_TOKEN not set — skipping edge-config drift check.');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toml = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');

// Minimal parse: capture each [functions.<name>] block's verify_jwt value.
const declared = {};
const re = /\[functions\.([a-z0-9-]+)\]([\s\S]*?)(?=\n\[|\s*$)/gi;
let m;
while ((m = re.exec(toml)) !== null) {
  const name = m[1];
  const body = m[2];
  const vj = /verify_jwt\s*=\s*(true|false)/i.exec(body);
  if (vj) declared[name] = vj[1].toLowerCase() === 'true';
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, {
  headers: {
    Authorization: `Bearer ${token}`,
    // Management API sits behind a WAF that blocks non-browser agents.
    'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36',
  },
});
if (!res.ok) {
  console.error(`Failed to list functions: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const deployed = await res.json();

const problems = [];
for (const fn of deployed) {
  if (!(fn.slug in declared)) {
    problems.push(`  ${fn.slug}: deployed (verify_jwt=${fn.verify_jwt}) but NOT declared in config.toml`);
  } else if (declared[fn.slug] !== fn.verify_jwt) {
    problems.push(
      `  ${fn.slug}: deployed verify_jwt=${fn.verify_jwt} but config.toml declares ${declared[fn.slug]}`,
    );
  }
}

if (problems.length) {
  console.error('Edge-function config drift detected:\n' + problems.join('\n'));
  console.error('\nReconcile supabase/config.toml with the deployment (or redeploy the function).');
  process.exit(1);
}
console.log(`Edge-function config in sync (${deployed.length} functions checked).`);
