// End-to-end smoke suite against the deployed monorepo test stack (PRD
// 23C). No browser, no new dependencies: logs in through the REAL NextAuth
// credentials flow (CSRF + cookie dance), then asserts the core dashboard
// contracts and the /api/v1 auth realm end to end - including refresh-token
// rotation and revocation. Exits non-zero on the first failure.
//
// Run:
//   npx tsx scripts/smoke-test.ts
// Env (all optional):
//   SMOKE_BASE     (default https://csq-dashboard.onrender.com)
//   SMOKE_API      (default https://csq-api.onrender.com)
//   SMOKE_EMAIL    (default admin@tokokopi.id)
//   SMOKE_PASSWORD (default demo1234)
import { z } from "zod";

const BASE = (process.env.SMOKE_BASE ?? "https://csq-dashboard.onrender.com").replace(/\/$/, "");
const API = (process.env.SMOKE_API ?? "https://csq-api.onrender.com").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL ?? "admin@tokokopi.id";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "demo1234";

const cookies = new Map<string, string>();

function absorbCookies(res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

const listEnvelope = z.object({
  success: z.literal(true),
  data: z.object({ items: z.array(z.object({ id: z.string() }).passthrough()) }),
});
// /api/v1/tools returns the summaries as a bare array, not an items wrapper.
const toolsEnvelope = z.object({
  success: z.literal(true),
  data: z.array(z.object({ name: z.string() }).passthrough()),
});
const tokenEnvelope = z.object({
  success: z.literal(true),
  data: z.object({
    accessToken: z.string().min(20),
    refreshToken: z.string().min(20),
    tokenType: z.literal("Bearer"),
    expiresIn: z.number(),
  }),
});

let failed = 0;
function check(ok: boolean, name: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}`);
  if (!ok) failed++;
}

async function main(): Promise<void> {
  // 1. Dashboard health.
  const health = await fetch(`${BASE}/api/health`);
  const healthBody = z.object({ success: z.literal(true), data: z.object({ status: z.literal("ok"), db: z.literal("up") }) }).safeParse(await health.json());
  check(health.status === 200 && healthBody.success, "dashboard health ok, db up");

  // 2-3. Real NextAuth credentials login.
  const csrf = await fetch(`${BASE}/api/auth/csrf`);
  absorbCookies(csrf);
  const { csrfToken } = await csrf.json();
  const login = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(),
    },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: "true" }).toString(),
    redirect: "manual",
  });
  absorbCookies(login);
  const hasSession = [...cookies.keys()].some(
    (k) => k === "next-auth.session-token" || k === "__Secure-next-auth.session-token"
  );
  check(login.status < 400 && hasSession, "NextAuth credentials login issues a session cookie");

  // 4. Session-gated reads return the envelope.
  const convs = await fetch(`${BASE}/api/dashboard/inbox/conversations?pageSize=5`, {
    headers: { cookie: cookieHeader() },
  });
  check(listEnvelope.safeParse(await convs.json()).success, "inbox conversations list 200 + envelope");

  const contacts = await fetch(`${BASE}/api/dashboard/contacts?pageSize=5`, {
    headers: { cookie: cookieHeader() },
  });
  check(listEnvelope.safeParse(await contacts.json()).success, "contacts list 200 + envelope");

  // 5. Session gating on a POST route: empty body must fail validation (not
  // auth) - proves the session carried through to the write path.
  const badPost = await fetch(`${BASE}/api/dashboard/inbox/conversations/00000000-0000-0000-0000-000000000000/messages`, {
    method: "POST",
    headers: { cookie: cookieHeader(), "content-type": "application/json" },
    body: "{}",
  });
  check(badPost.status === 400 || badPost.status === 404, "session works on POST routes (validation/not-found, not 401)");

  // 6. Unauthenticated read is rejected.
  const noAuth = await fetch(`${BASE}/api/dashboard/contacts`);
  check(noAuth.status === 401, "dashboard rejects unauthenticated reads (401)");

  // 7. /api/v1 without a token is rejected.
  const v1NoToken = await fetch(`${API}/api/v1/tools`);
  check(v1NoToken.status === 401, "/api/v1 rejects missing bearer token (401)");

  // 8. The mobile realm: credentials -> token pair.
  const tokenRes = await fetch(`${API}/api/v1/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const tokenBody = tokenEnvelope.safeParse(await tokenRes.json());
  check(tokenBody.success, "/api/v1/auth/token exchanges credentials for a pair");
  if (!tokenBody.success) return finish();
  const first = tokenBody.data.data;

  // 9. The access JWT drives the v1 surface.
  const tools = await fetch(`${API}/api/v1/tools`, {
    headers: { authorization: `Bearer ${first.accessToken}` },
  });
  check(toolsEnvelope.safeParse(await tools.json()).success, "access JWT authenticates /api/v1/tools");

  // 10. Refresh rotation: new pair, and the OLD refresh token is dead.
  const refreshRes = await fetch(`${API}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: first.refreshToken }),
  });
  const refreshBody = tokenEnvelope.safeParse(await refreshRes.json());
  check(refreshBody.success, "/api/v1/auth/refresh rotates the pair");
  if (!refreshBody.success) return finish();
  const second = refreshBody.data.data;

  const replay = await fetch(`${API}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: first.refreshToken }),
  });
  check(replay.status === 401, "a rotated refresh token cannot be replayed (401)");

  // 11. Logout revokes; the logged-out token cannot refresh.
  const logout = await fetch(`${API}/api/v1/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: second.refreshToken }),
  });
  check(logout.status === 200, "/api/v1/auth/logout revokes (idempotent 200)");
  const afterLogout = await fetch(`${API}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: second.refreshToken }),
  });
  check(afterLogout.status === 401, "a logged-out refresh token is dead (401)");

  finish();
}

function finish(): void {
  if (failed > 0) {
    console.error(`${failed} smoke check(s) FAILED`);
    process.exit(1);
  }
  console.log("all smoke checks passed");
}

void main();
