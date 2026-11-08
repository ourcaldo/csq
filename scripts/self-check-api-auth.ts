// Assert-based self-check for the /api/v1 token primitives (PRD 23C
// Phase 7): token format, hash determinism, and prefix derivation. No DB.
// Run:
//   npx tsx scripts/self-check-api-auth.ts
import {
  generateApiToken,
  hashApiToken,
} from "../packages/core/src/lib/api-tokens";

const checks: Array<[string, boolean]> = [];

const a = generateApiToken();
const b = generateApiToken();
checks.push(["token uses the csq_ prefix", a.token.startsWith("csq_")]);
checks.push([
  "hash is 64-char sha256 hex",
  /^[0-9a-f]{64}$/.test(a.hash) && a.hash === hashApiToken(a.token),
]);
checks.push([
  "prefix is the first 12 chars",
  a.prefix === a.token.slice(0, 12),
]);
checks.push(["two mints never collide", a.token !== b.token && a.hash !== b.hash]);
checks.push([
  "hash differs from token (never store plaintext)",
  a.hash !== a.token,
]);

for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}`);
  if (!ok) process.exit(1);
}
console.log(`all ${checks.length} api-auth checks passed`);
