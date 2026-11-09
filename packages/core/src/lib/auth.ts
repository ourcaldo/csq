import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult,
} from "next";
import type { NextApiRequest, NextApiResponse } from "next";
import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { verifyPassword } from "@csq/core/lib/password";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";
import type { PlanFeature } from "@csq/core/types/entitlements";

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
      async authorize(credentials) {
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

          const user = await prisma.user.findUnique({ where: { email } });
          if (!user) return null;

          // Phase 2 (PRD 13) + SEC-4 (PRD 16): a suspended tenant's users CAN
          // authenticate (the credentials are valid), but every SSR page
          // redirects to /suspended and getAuthSession returns null, so the
          // dashboard is fully locked. Keeping the sign-in itself working
          // gives them the clear suspended message instead of a misleading
          // "wrong password".

          const ok = await verifyPassword(password, user.passwordHash);
          if (!ok) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            tenantId: user.tenantId,
            role: user.role,
            canRunCampaigns: user.canRunCampaigns,
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
        token.role = user.role;
        token.canRunCampaigns = user.canRunCampaigns;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.tenantId = token.tenantId;
        session.user.role = token.role;
        session.user.canRunCampaigns = token.canRunCampaigns ?? false;
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
export function withAuth<P extends Record<string, unknown> = Record<string, unknown>>(
  gssp: GetServerSideProps<P>,
  options?: { requiredRole?: UserRole }
): GetServerSideProps<P> {
  return async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<P>> => {
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
    if (options?.requiredRole && session.user.role !== options.requiredRole) {
      return { redirect: { destination: "/dashboard", permanent: false } };
    }
    return gssp(ctx);
  };
}

export async function getSSRSession(ctx: GetServerSidePropsContext): Promise<Session | null> {
  return getServerSession(ctx.req, ctx.res, authOptions);
}

// API route session helper - call first in every tenant-touching API route.
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
  return session;
}

// Role guard for API routes. Returns true if the session's role is one of the
// allowed roles. Use before OWNER-only (or OWNER+STAFF) mutations:
//   if (!requireRole(session, "OWNER")) return respondError(res, "PERMISSION_DENIED", ...);
export function requireRole(session: Session, ...roles: UserRole[]): boolean {
  return roles.includes(session.user.role);
}

// Pre-configured withAuth that only guards access (no custom props). Use for
// dashboard pages that fetch their data client-side via use-api. Concrete
// (non-generic) so the empty props object type-checks without a type cast.
export function requireAuth(
  options?: { requiredRole?: UserRole }
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
    const session = await getSSRSession(ctx);
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

