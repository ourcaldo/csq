// Assert-based self-check for the /api/v1 user-realm JWT primitives (PRD
// 23C Phase 8): sign/verify round-trip, tamper rejection, wrong-secret
// rejection, and the refresh-token hash contract. No DB. The secret is read
// lazily inside the library, so setting it here before the calls is enough.
// Run:
//   npx tsx scripts/self-check-api-jwt.ts
import { signAccessToken, verifyAccessToken } from "../packages/core/src/lib/api-jwt";
import {
  generateRefreshToken,
  hashRefreshToken,
} from "../packages/core/src/lib/refresh-tokens";

async function main(): Promise<void> {
  process.env.API_JWT_SECRET = "self-check-secret";
  const checks: Array<[string, boolean]> = [];

  const token = await signAccessToken({
    userId: "u1",
    tenantId: "t1",
    role: "OWNER",
  });
  const verified = await verifyAccessToken(token);
  checks.push([
    "sign -> verify round-trip carries claims",
    !!verified &&
      verified.userId === "u1" &&
      verified.tenantId === "t1" &&
      verified.role === "OWNER",
  ]);
  checks.push([
    "tampered token rejected",
    (await verifyAccessToken(token.slice(0, -2) + "x")) === null,
  ]);

  process.env.API_JWT_SECRET = "a-different-secret";
  checks.push([
    "token signed with another secret rejected",
    (await verifyAccessToken(token)) === null,
  ]);
  delete process.env.API_JWT_SECRET;
  checks.push([
    "no configured secret authenticates nothing (fail-closed)",
    (await verifyAccessToken(token)) === null,
  ]);

  const rt = generateRefreshToken();
  checks.push([
    "refresh token format + deterministic hash",
    rt.token.startsWith("rt_") &&
      rt.hash === hashRefreshToken(rt.token) &&
      /^[0-9a-f]{64}$/.test(rt.hash),
  ]);
  checks.push([
    "two refresh tokens never collide",
    (() => {
      const b = generateRefreshToken();
      return b.token !== rt.token && b.hash !== rt.hash;
    })(),
  ]);

  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"} - ${name}`);
    if (!ok) process.exit(1);
  }
  console.log(`all ${checks.length} api-jwt checks passed`);
}

void main();
