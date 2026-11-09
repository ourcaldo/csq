import type { NextApiRequest, NextApiResponse } from "next";
import type { GetServerSideProps, GetServerSidePropsContext } from "next";
import type { GetServerSidePropsResult } from "next";
import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { hashPassword, verifyPassword } from "@csq/core/lib/password";
import { checkRateLimit } from "@csq/core/lib/rate-limit";
import { apiError, type ApiResponse } from "@csq/core/types/api";

// The admin auth realm (PRD 13). Everything mirrors the tenant realm's
// pattern (core/lib/auth.ts) but against the AdminUser table with its own
// session shape and cookie secret - the two realms can never cross.

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email().min(1),
  password: z.string().min(1),
});

export const adminAuthOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  // SEC-5 (PRD 16): a distinct cookie name so the admin realm's session can
  // never collide with the tenant realm's, even if the two ever share a host.
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-csq.admin.session-token"
          : "csq-admin-session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    CredentialsProvider({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        // SEC-5 (PRD 16): per-IP rate limit on the operator login.
        const ipRaw = req?.headers?.["x-forwarded-for"];
        const ip = ((Array.isArray(ipRaw) ? ipRaw[0] : ipRaw) ?? "unknown")
          .split(",")[0]
          .trim();
        if (!checkRateLimit(`admin-auth:${ip}`, 10, 60_000)) return null;

        const parsed = signInSchema.safeParse({
          email: credentials?.email,
          password: credentials?.password,
        });
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // AdminUser lookups cross no tenant but run before any request
        // context exists: bypass context (PRD 16 SEC-1). Unknown emails
        // still burn a bcrypt round (SEC-5 timing equalization).
        return withSystemContext(async () => {
          const admin = await prisma.adminUser.findUnique({ where: { email } });
          const ok = await verifyPassword(
            password,
            admin?.passwordHash ?? (await hashPassword(password))
          );
          if (!admin || !ok) return null;
          return { id: admin.id, email: admin.email, name: admin.name };
        });
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user && user.id) {
        token.adminId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.adminId;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
};

export async function getAdminSession(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<Session | null> {
  return getServerSession(req, res, adminAuthOptions);
}

// SSR guard for /admin/* - mirrors the tenant realm's withAuth: no Next.js
// middleware (PRD 23B.6 pattern), the page itself redirects.
export function withAdminAuth<P extends Record<string, unknown> = Record<string, unknown>>(
  handler: (ctx: GetServerSidePropsContext) => Promise<GetServerSidePropsResult<P>>
): GetServerSideProps<P> {
  return async (ctx: GetServerSidePropsContext) => {
    const session = await getServerSession(ctx.req, ctx.res, adminAuthOptions);
    if (!session) {
      return {
        redirect: { destination: "/login", permanent: false },
      };
    }
    return handler(ctx);
  };
}

export function respondAdminError(
  res: NextApiResponse,
  code: string,
  message: string
): void {
  res.status(500).json(apiError(code as never, message));
}

// Audit an operator mutation (PRD 13: every admin write lands here with
// actor + before/after). Call AFTER the mutation succeeds so the log never
// records an action that did not happen.
export async function auditAdminAction(input: {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
}): Promise<void> {
  await prisma.adminActionLog
    .create({
      data: {
        adminId: input.adminId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        beforeValue: input.beforeValue === undefined ? undefined : (input.beforeValue as object),
        afterValue: input.afterValue === undefined ? undefined : (input.afterValue as object),
      },
    })
    .catch((err: unknown) =>
      console.error("[admin] audit log write failed:", err)
    );
}

// Shared BFF boilerplate: authenticate the operator or reject.
export type AdminGuarded = { adminId: string; email: string };
export async function requireAdmin(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
): Promise<AdminGuarded | null> {
  const session = await getAdminSession(req, res);
  if (!session || !session.user?.id) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(401).json(apiError("UNAUTHORIZED", "Login admin diperlukan."));
    return null;
  }
  return { adminId: session.user.id, email: session.user.email ?? "" };
}

export type { ApiResponse };
