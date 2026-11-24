import prisma from "@csq/core/lib/db";
import { hashPassword } from "@csq/core/lib/password";
import { AKSES_PENUH_KEYS, ADMIN_CHAT_KEYS } from "@csq/core/lib/permissions-catalog";

// Shared tenant provisioning (PRD 16 ADM-8): dashboard register and admin
// tenant-create both go through this helper so every tenant starts with
// identical defaults. Callers must already hold a withSystemContext wrap -
// the create crosses no tenant yet, so it runs in the bypass context.
// PRD 29: every new tenant is seeded with the two system roles.

export type ProvisionTenantInput = {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
  // Default true: the password is an admin-issued bootstrap credential -
  // single-use by policy (audit run-3), rotated at first login. Public
  // self-signup passes false: the user chose the password themselves, so
  // forcing an immediate rotation (with the "set by the platform admin"
  // message) is wrong.
  requirePasswordChange?: boolean;
};

export async function createTenantWithOwner(
  input: ProvisionTenantInput
): Promise<{ tenantId: string; userId: string }> {
  const passwordHash = await hashPassword(input.ownerPassword);
  const mustRotate = input.requirePasswordChange !== false;
  const tenant = await prisma.tenant.create({
    data: {
      name: input.name,
      slug: input.slug,
      status: "ACTIVE",
      settings: { sourcePriority: ["MANUAL", "GOOGLE_SHEETS", "EXCEL", "MEMORY"] },
      roles: {
        create: [
          {
            name: "Akses Penuh",
            description: "Semua akses kecuali khusus pemilik.",
            isSystem: true,
            permissions: [...AKSES_PENUH_KEYS],
          },
          {
            name: "Admin Chat",
            description:
              "Operator chat: aksi penuh di percakapan, kontak, pipeline, tiket, dan template.",
            isSystem: true,
            permissions: [...ADMIN_CHAT_KEYS],
          },
        ],
      },
      users: {
        create: {
          email: input.ownerEmail,
          name: input.ownerName,
          isOwner: true,
          passwordHash,
          // Audit run-3: the emailed bootstrap password is single-use by
          // policy - the owner rotates it at first login. Public self-signup
          // (requirePasswordChange: false) chose the password itself.
          mustChangePassword: mustRotate,
          passwordChangedAt: mustRotate ? new Date() : null,
        },
      },
    },
    select: { id: true, users: { select: { id: true } } },
  });
  return { tenantId: tenant.id, userId: tenant.users[0].id };
}
