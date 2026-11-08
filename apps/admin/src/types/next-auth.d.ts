import type { DefaultSession } from "next-auth";

// The ADMIN session shape (PRD 13). Deliberately its own type - an admin
// session never carries tenantId or tenant roles. The tenant realm's
// next-auth.d.ts lives in the dashboard and api apps; this one is the
// admin realm's, and they never mix.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    adminId: string;
  }
}
