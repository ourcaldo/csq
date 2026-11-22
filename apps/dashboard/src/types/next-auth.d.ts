import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

// Augment NextAuth types so the session carries id + tenant + role + the
// campaign permission. v4's Session.user is DefaultSession["user"]
// (name/email/image) by default, so we redeclare it with the extra fields
// intersected onto the default shape.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      role: UserRole;
      // Campaign permission (feature plan 2026-11-01, decision 2.2): OWNER
      // always has it; STAFF only when the owner toggles it on the Team page.
      canRunCampaigns: boolean;
      // Audit run-3: forced-rotation flag + the revocation stamp echoed from
      // the JWT (getAuthSession re-checks both against the DB).
      mustChangePassword: boolean;
      passwordChangedAt: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId: string;
    role: UserRole;
    canRunCampaigns: boolean;
    mustChangePassword: boolean;
    passwordChangedAt: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    tenantId: string;
    role: UserRole;
    canRunCampaigns: boolean;
    mustChangePassword: boolean;
    passwordChangedAt: string | null;
  }
}
