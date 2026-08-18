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
import prisma from "@/lib/db";
import { verifyPassword } from "@/lib/password";

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
        const parsed = signInSchema.safeParse({
          email: credentials?.email,
          password: credentials?.password,
        });
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
          role: user.role,
        };
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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.tenantId = token.tenantId;
        session.user.role = token.role;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
};

// SSR guard for /dashboard/* — NO Next.js middleware (PRD §23B.6).
// withAuth only guards access; pages that need session data call getSSRSession
// themselves (avoids prop-merging type casts under the no-`as` rule).
export function withAuth<P extends Record<string, unknown> = Record<string, unknown>>(
  gssp: GetServerSideProps<P>,
  options?: { requiredRole?: UserRole }
): GetServerSideProps<P> {
  return async (ctx: GetServerSidePropsContext): Promise<GetServerSidePropsResult<P>> => {
    const session = await getServerSession(ctx.req, ctx.res, authOptions);
    if (!session) {
      return { redirect: { destination: "/login", permanent: false } };
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

// API route session helper — call first in every tenant-touching API route.
export async function getAuthSession(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<Session | null> {
  return getServerSession(req, res, authOptions);
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

// Like withAuth but does NOT redirect when unauthenticated — for pages that
// render for both signed-in and signed-out visitors. The page reads the
// session via getSSRSession if it needs it.
export function optionalAuth<P extends Record<string, unknown> = Record<string, unknown>>(
  gssp: GetServerSideProps<P>
): GetServerSideProps<P> {
  return async (ctx): Promise<GetServerSidePropsResult<P>> => gssp(ctx);
}

