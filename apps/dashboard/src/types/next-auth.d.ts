import type { DefaultSession } from "next-auth";
import type { PermissionKey } from "@csq/core/lib/permissions-catalog";

// Augment NextAuth types so the session carries id + tenant + the PRD 29
// realm fields. v4's Session.user is DefaultSession["user"]
// (name/email/image) by default, so we redeclare it with the extra fields
// intersected onto the default shape.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      // PRD 29: isOwner replaces the OWNER/STAFF enum. The owner always
      // holds every permission incl. the owner-only keys.
      isOwner: boolean;
      // Fresh per-request permission set (API routes get it from
      // getAuthSession; UI consumers get the sign-in snapshot).
      permissions: PermissionKey[];
      // Audit run-3: forced-rotation flag + the revocation stamp echoed from
      // the JWT (getAuthSession re-checks both against the DB).
      mustChangePassword: boolean;
      passwordChangedAt: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId: string;
    isOwner: boolean;
    permissions: PermissionKey[];
    mustChangePassword: boolean;
    passwordChangedAt: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    tenantId: string;
    isOwner: boolean;
    permissions: PermissionKey[];
    mustChangePassword: boolean;
    passwordChangedAt: string | null;
  }
}
