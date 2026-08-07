import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = process.env.BUILD_SHA;
if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
  throw new Error('BUILD_SHA must be a full 40-character Git commit SHA.');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'app/public/version.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify({ sha, builtAt: new Date().toISOString() })}\n`);
console.log(`Prepared build provenance for ${sha}.`);
