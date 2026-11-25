// Runs every e2e suite against a running API. Suites are spaced a minute apart because
// each signs up fresh users and the API (correctly) rate-limits signups to 5/minute per IP.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const suites = ['auth.e2e.mjs', 'teams.e2e.mjs', 'contests.e2e.mjs', 'socket.e2e.mjs', 'wallet.e2e.mjs', 'account.e2e.mjs', 'admin.e2e.mjs', 'security.e2e.mjs'];
const only = process.argv[2];
const GAP_MS = 61_000;

let failed = 0;
for (const [i, suite] of suites.entries()) {
  if (only && !suite.startsWith(only)) continue;
  if (i > 0 && !only) {
    console.log(`\n… waiting ${GAP_MS / 1000}s for the signup rate-limit window`);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  console.log(`\n=== ${suite} ===`);
  const res = spawnSync(process.execPath, [join(here, suite)], { stdio: 'inherit' });
  if (res.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nAll e2e suites passed');
process.exit(failed ? 1 : 0);
