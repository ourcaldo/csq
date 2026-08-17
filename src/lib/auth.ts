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
import prisma from "@/lib/db";
import { verifyPassword } from "@/lib/password";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

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
