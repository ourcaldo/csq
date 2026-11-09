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
//   ADMIN_BASE     (default https://csq-admin.onrender.com)
//   ADMIN_EMAIL / ADMIN_PASSWORD - when BOTH are set, the admin-console
//   section (ADM-7, PRD 16) runs: operator login, tenant list, and the
//   suspended-tenant lockout. When unset, that section is skipped.
import { z } from "zod";

const BASE = (process.env.SMOKE_BASE ?? "https://csq-dashboard.onrender.com").replace(/\/$/, "");
const API = (process.env.SMOKE_API ?? "https://csq-api.onrender.com").replace(/\/$/, "");
const ADMIN_BASE = (process.env.ADMIN_BASE ?? "https://csq-admin.onrender.com").replace(/\/$/, "");
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

  await adminChecks();

  finish();
}

// ADM-7 (PRD 16): the operator console checks. A separate cookie jar - the
// admin realm's session cookie is deliberately distinct from the dashboard's.
async function adminChecks(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.log("SKIP - admin console checks (ADMIN_EMAIL/ADMIN_PASSWORD unset)");
    return;
  }

  const adminCookies = new Map<string, string>();
  const adminCookieHeader = () =>
    [...adminCookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const absorbAdmin = (res: Response): void => {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) adminCookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  };

  // Operator login through the REAL NextAuth dance.
  const csrf = await fetch(`${ADMIN_BASE}/api/auth/csrf`);
  absorbAdmin(csrf);
  const { csrfToken } = await csrf.json();
  const login = await fetch(`${ADMIN_BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: adminCookieHeader(),
    },
    body: new URLSearchParams({ csrfToken, email: adminEmail, password: adminPassword, json: "true" }).toString(),
    redirect: "manual",
  });
  absorbAdmin(login);
  const adminSessionOk = [...adminCookies.keys()].some((k) => k.includes("session-token"));
  check(login.status < 400 && adminSessionOk, "admin console login issues a session cookie");

  const authHeaders = { cookie: adminCookieHeader(), "content-type": "application/json" };

  // Tenant list.
  const tenantsRes = await fetch(`${ADMIN_BASE}/api/admin/tenants`, { headers: authHeaders });
  const tenantsBody = z
    .object({ success: z.literal(true), data: z.object({ items: z.array(z.object({ id: z.string(), status: z.string() }).passthrough()) }) })
    .safeParse(await tenantsRes.json());
  check(tenantsRes.status === 200 && tenantsBody.success, "admin tenant list 200 + envelope");
  if (!tenantsBody.success) return;

  // The suspended-tenant lockout. Reuse a permanent scratch tenant so reruns
  // never multiply admin-visible data.
  const scratchSlug = "smoke-scratch";
  const existing = tenantsBody.data.data.items.find((t) => t.slug === scratchSlug);
  let scratchId: string | null = existing?.id ?? null;
  if (!scratchId) {
    const create = await fetch(`${ADMIN_BASE}/api/admin/tenants`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Smoke Scratch",
        slug: scratchSlug,
        ownerEmail: "smoke-scratch@csq.local",
        ownerName: "Smoke Scratch",
        ownerPassword: "smoke-scratch-password",
      }),
    });
    const created = z
      .object({ success: z.literal(true), data: z.object({ id: z.string() }).passthrough() })
      .safeParse(await create.json());
    check(create.status === 201 && created.success, "admin tenant create (scratch)");
    scratchId = created.success ? created.data.data.id : null;
  } else {
    check(true, "admin tenant scratch reused from a previous run");
  }
  if (!scratchId) return;

  try {
    // Suspend.
    const suspend = await fetch(`${ADMIN_BASE}/api/admin/tenants/${scratchId}`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "suspend" }),
    });
    check(suspend.status === 200, "admin suspend action 200");

    // The suspended tenant's owner authenticates on the dashboard but is
    // locked out: BFF reads 401, SSR redirects to /suspended.
    const scratchCookies = new Map<string, string>();
    const scratchHeader = () =>
      [...scratchCookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const absorbScratch = (res: Response): void => {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) scratchCookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    };
    const srf = await fetch(`${BASE}/api/auth/csrf`);
    absorbScratch(srf);
    const { csrfToken: scratchCsrf } = await srf.json();
    const scratchLogin = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: scratchHeader(),
      },
      body: new URLSearchParams({ csrfToken: scratchCsrf, email: "smoke-scratch@csq.local", password: "smoke-scratch-password", json: "true" }).toString(),
      redirect: "manual",
    });
    absorbScratch(scratchLogin);
    check(scratchLogin.status < 400, "suspended tenant owner can still authenticate");

    const locked = await fetch(`${BASE}/api/dashboard/contacts`, {
      headers: { cookie: scratchHeader() },
    });
    check(locked.status === 401, "suspended tenant BFF reads are locked out (401)");

    const ssr = await fetch(`${BASE}/dashboard`, {
      headers: { cookie: scratchHeader() },
      redirect: "manual",
    });
    const location = ssr.headers.get("location") ?? "";
    check(
      ssr.status === 307 && location.includes("/suspended"),
      "suspended tenant SSR redirects to /suspended"
    );
  } finally {
    // Always reactivate so a failed run never leaves the scratch suspended.
    await fetch(`${ADMIN_BASE}/api/admin/tenants/${scratchId}`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "activate" }),
    });
  }

  // Unauthenticated admin read is rejected.
  const noAuth = await fetch(`${ADMIN_BASE}/api/admin/tenants`);
  check(noAuth.status === 401, "admin console rejects unauthenticated reads (401)");
}

function finish(): void {
  if (failed > 0) {
    console.error(`${failed} smoke check(s) FAILED`);
    process.exit(1);
  }
  console.log("all smoke checks passed");
}

void main();
