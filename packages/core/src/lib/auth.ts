import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult,
} from "next";
import type { NextApiRequest, NextApiResponse } from "next";
import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { verifyPassword, hashPassword } from "@csq/core/lib/password";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";
import { checkRateLimit } from "@csq/core/lib/rate-limit";
import { clientIp } from "@csq/core/lib/client-ip";
import type { PlanFeature } from "@csq/core/types/entitlements";
import {
  ALL_KEYS,
  OWNER_ONLY_KEYS,
  expandPermissions,
  type PermissionKey,
} from "@csq/core/lib/permissions-catalog";

// Sign-in input validation (matches the register schema's shape). Applied at
// the authorize() boundary so untrusted credentials are Zod-validated, not
// just trimmed/checked for presence.
const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email().min(1),
  password: z.string().min(1),
});

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        // Audit run-2 finding #1 (dashboard-auth.no-throttle): brute-force
        // throttle on the tenant login, mirroring the admin and api realms.
        // clientIp (X-Real-IP -> LAST XFF -> unknown) - never the first XFF
        // element, which the client controls on append-style proxies (Render).
        const ip = clientIp(req);
        if (!checkRateLimit(`dash-auth:${ip}`, 10, 60_000)) return null;
        // The email lookup happens before the tenant is known, so it runs in
        // the bypass context (PRD 16 SEC-1); everything after sign-in is
        // tenant-scoped via the request wrappers.
        return withSystemContext(async () => {
          const parsed = signInSchema.safeParse({
            email: credentials?.email,
            password: credentials?.password,
          });
          if (!parsed.success) return null;
          const { email, password } = parsed.data;

          const user = await prisma.user.findUnique({
            where: { email },
            include: { role: { select: { permissions: true } } },
          });
          const ok = await verifyPassword(
            password,
            user?.passwordHash ?? (await hashPassword(password))
          );
          if (!user || !ok) return null;

          // Phase 2 (PRD 13) + SEC-4 (PRD 16): a suspended tenant's users CAN
          // authenticate (the credentials are valid), but every SSR page
          // redirects to /suspended and getAuthSession returns null, so the
          // dashboard is fully locked. Keeping the sign-in itself working
          // gives them the clear suspended message instead of a misleading
          // "wrong password".

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            tenantId: user.tenantId,
            isOwner: user.isOwner,
            // Sign-in snapshot for the UI; enforcement reloads per request.
            permissions: user.isOwner
              ? [...ALL_KEYS]
              : [...expandPermissions(user.role?.permissions ?? [])],
            // Audit run-3 (admin.tenant-owner-takeover): revocation stamp +
            // rotation flag, both re-checked against the DB on every request.
            passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
            mustChangePassword: user.mustChangePassword,
          };
        });
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on first sign-in; persist identity into the JWT.
      if (user && user.id) {
        token.userId = user.id;
        token.tenantId = user.tenantId;
        token.isOwner = user.isOwner;
        token.permissions = user.permissions;
        token.passwordChangedAt = user.passwordChangedAt;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.tenantId = token.tenantId;
        session.user.isOwner = token.isOwner ?? false;
        session.user.permissions = token.permissions ?? [];
        session.user.mustChangePassword = token.mustChangePassword ?? false;
        // Revocation stamp echoed so getAuthSession can compare it with the
        // DB without a cast (no secret - just a timestamp).
        session.user.passwordChangedAt = token.passwordChangedAt ?? null;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
};

// SSR guard for /dashboard/* - NO Next.js middleware (PRD §23B.6).
// withAuth only guards access; pages that need session data call getSSRSession
// themselves (avoids prop-merging type casts under the no-`as` rule).
// SEC-4 (PRD 16): a suspended tenant's live sessions land on /suspended, a
// clear error page instead of a broken dashboard.
// Audit run-3: also enforces the revocation stamp (stale session -> login)
// and the forced-rotation redirect to /ubah-password.
const CHANGE_PASSWORD_PAGE = "/ubah-password";

// The block result is always a redirect - typed as the redirect-only variant
// of GetServerSidePropsResult so it assigns into any page's P.
type SsrBlock = { redirect: { destination: string; permanent: boolean } };

async function ssrSessionValid(
  ctx: GetServerSidePropsContext,
  destination: string
): Promise<SsrBlock | null> {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (!session) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  if (session.user.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { status: true },
    });
    if (tenant?.status === "SUSPENDED") {
      return { redirect: { destination: "/suspended", permanent: false } };
    }
  }
  if (session.user.id) {
    if (!(await passwordStampValid(session.user.id, session.user.passwordChangedAt))) {
      return { redirect: { destination: "/login", permanent: false } };
    }
  }
  if (
    session.user.mustChangePassword &&
    ctx.resolvedUrl.split("?")[0] !== CHANGE_PASSWORD_PAGE
  ) {
    return { redirect: { destination: CHANGE_PASSWORD_PAGE, permanent: false } };
  }
  return null;
}

export function withAuth<P extends Record<string, unknown> = Record<string, unknown>>(
  gssp: GetServerSideProps<P>,
  options?: { requiredPermission?: PermissionKey }
): GetServerSideProps<P> {
  return async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<P>> => {
    const blocked = await ssrSessionValid(ctx, "/login");
    if (blocked) return blocked;
    if (options?.requiredPermission) {
      const session = await getSSRSession(ctx);
      if (!session?.user.id) {
        return { redirect: { destination: "/login", permanent: false } };
      }
      const fresh = await loadAuthUser(session.user.id);
      if (!fresh || !hasPermission({ isOwner: fresh.isOwner, permissions: fresh.permissions }, options.requiredPermission)) {
        return { redirect: { destination: "/dashboard", permanent: false } };
      }
    }
    return gssp(ctx);
  };
}

export async function getSSRSession(ctx: GetServerSidePropsContext): Promise<Session | null> {
  return getServerSession(ctx.req, ctx.res, authOptions);
}

// API route session helper - call first in every tenant-touching API route.
// PRD 29 section 8: the per-request auth load. ONE system-context query
// fetches the revocation stamp, the owner flag, and the user's role
// permissions - so both a password write and a role change take effect on
// the target's very next request (no stale-JWT privilege retention).
// RLS (PRD 16 SEC-1): User is a tenant table - contextless queries fail
// CLOSED, and the check predates knowing the tenant, so like authorize()'s
// email lookup it runs in the system-bypass context.
export type AuthUser = {
  passwordChangedAt: string | null;
  isOwner: boolean;
  permissions: PermissionKey[];
};

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await withSystemContext(async () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        passwordChangedAt: true,
        isOwner: true,
        role: { select: { permissions: true } },
      },
    })
  );
  if (!user) return null;
  return {
    passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
    isOwner: user.isOwner,
    permissions: user.isOwner
      ? [...ALL_KEYS]
      : [...expandPermissions(user.role?.permissions ?? [])],
  };
}

async function passwordStampValid(
  userId: string,
  tokenStamp: string | null | undefined
): Promise<boolean> {
  const user = await loadAuthUser(userId);
  if (!user) return false;
  return (tokenStamp ?? null) === user.passwordChangedAt;
}

// The one API path a mustChangePassword user may reach: setting their new
// password. Everything else stays locked until the rotation happens.
const PASSWORD_CHANGE_PATH = "/api/dashboard/account/password";

export async function getAuthSession(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<Session | null> {
  const session = await getServerSession(req, res, authOptions);
  // Phase 2 (PRD 13): a SUSPENDED tenant's users get no session at all -
  // every BFF route returns the standard 401, and the login page shows the
  // suspended message via the authorize() check. Data never stops flowing
  // (the worker keeps ingesting); the UI is simply gated here.
  if (session?.user?.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { status: true },
    });
    if (tenant?.status === "SUSPENDED") return null;
  }
  // Audit run-3 + PRD 29: revocation stamp AND fresh permissions, both from
  // the same single loadAuthUser query.
  if (session?.user?.id) {
    const fresh = await loadAuthUser(session.user.id);
    if (!fresh || (session.user.passwordChangedAt ?? null) !== fresh.passwordChangedAt) {
      return null;
    }
    session.user.isOwner = fresh.isOwner;
    session.user.permissions = fresh.permissions;
  }
  // Audit run-3: forced rotation - a user flagged mustChangePassword
  // (admin reset, tenant bootstrap) can do nothing except set a new
  // password. The change page itself must stay reachable.
  if (session?.user?.mustChangePassword) {
    const path = (req.url ?? "").split("?")[0];
    if (path !== PASSWORD_CHANGE_PATH) return null;
  }
  return session;
}

// PRD 29 permission gate for API routes. The owner holds every permission;
// owner-only keys are never satisfiable by a role grant (the role CRUD API
// filters them on write - this is the enforcement-side backstop).
//   if (!requirePermission(session, "produk.kelola")) return respondError(res, "PERMISSION_DENIED", ...);
export function hasPermission(
  auth: { isOwner: boolean; permissions: PermissionKey[] },
  key: PermissionKey
): boolean {
  if (auth.isOwner) return true;
  if (OWNER_ONLY_KEYS.includes(key)) return false;
  return auth.permissions.includes(key);
}

export function requirePermission(session: Session, key: PermissionKey): boolean {
  return hasPermission(session.user, key);
}

// Owner-only gates (PRD 29: peran/pengaturan-tim/apikeys/audit/billing).
export function requireOwner(session: Session): boolean {
  return session.user.isOwner;
}

// Pre-configured withAuth that only guards access (no custom props). Use for
// dashboard pages that fetch their data client-side via use-api. Concrete
// (non-generic) so the empty props object type-checks without a type cast.
export function requireAuth(
  options?: { requiredPermission?: PermissionKey }
): GetServerSideProps<Record<string, unknown>> {
  return withAuth<Record<string, unknown>>(
    async () => ({ props: {} }),
    options
  );
}

// Like withAuth but also requires a plan feature. A tenant with no plan gets
// every feature (legacy); a plan without the key is redirected to the
// dashboard. The page is the UI gate - the feature's API and worker paths are
// gated separately where they can consume money (credits, sends).
export function withFeature<P extends Record<string, unknown>>(
  feature: PlanFeature,
  gssp: GetServerSideProps<P>
): GetServerSideProps<P> {
  return async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<P>> => {
    const blocked = await ssrSessionValid(ctx, "/login");
    if (blocked) return blocked;
    const session = await getSSRSession(ctx);
    if (!session) {
      return { redirect: { destination: "/login", permanent: false } };
    }
    const entitlements = await getTenantEntitlements(session.user.tenantId);
    if (!entitlements.features.includes(feature)) {
      return { redirect: { destination: "/dashboard", permanent: false } };
    }
    return gssp(ctx);
  };
}

// Like withAuth but does NOT redirect when unauthenticated - for pages that
// render for both signed-in and signed-out visitors. The page reads the
// session via getSSRSession if it needs it.
export function optionalAuth<P extends Record<string, unknown> = Record<string, unknown>>(
  gssp: GetServerSideProps<P>
): GetServerSideProps<P> {
  return async (ctx): Promise<GetServerSidePropsResult<P>> => gssp(ctx);
}

