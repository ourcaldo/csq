import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

// Augment NextAuth types so the session carries id + tenant + role + the
// campaign permission. v4's Session.user is DefaultSession["user"]
// (name/email/image) by default, so we redeclare it with the extra fields
// intersected onto the default shape.
// Copy of apps/dashboard/src/types/next-auth.d.ts (PRD 23C Phase 7): the
// session shape is defined by core's auth helpers, and each app's TS program
// needs the augmentation in its own include path. Extract to a shared file
// when a third app needs it (repo rule: extract on the third occurrence).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      role: UserRole;
      // Campaign permission (feature plan 2026-11-01, decision 2.2): OWNER
      // always has it; STAFF only when the owner toggles it on the Team page.
      canRunCampaigns: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId: string;
    role: UserRole;
    canRunCampaigns: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    tenantId: string;
    role: UserRole;
    canRunCampaigns: boolean;
  }
}
