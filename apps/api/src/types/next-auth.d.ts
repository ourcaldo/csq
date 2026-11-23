import type { DefaultSession } from "next-auth";

// Augment NextAuth types for the API service's own program. The session
// shape is defined by core's auth helpers (PRD 29: isOwner replaces the
// OWNER/STAFF enum); each app's TS program needs the augmentation in its
// own include path.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      isOwner: boolean;
      permissions: string[];
    } & DefaultSession["user"];
  }

  interface User {
    tenantId: string;
    isOwner: boolean;
    permissions: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    tenantId: string;
    isOwner: boolean;
    permissions: string[];
  }
}
