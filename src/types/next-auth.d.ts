import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

// Augment NextAuth types so the session carries id + tenant + role. v4's
// Session.user is DefaultSession["user"] (name/email/image) by default, so we
// redeclare it with the extra fields intersected onto the default shape.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId: string;
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    tenantId: string;
    role: UserRole;
  }
}
