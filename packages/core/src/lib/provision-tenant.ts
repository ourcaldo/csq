import prisma from "@csq/core/lib/db";
import { hashPassword } from "@csq/core/lib/password";

// Shared tenant provisioning (PRD 16 ADM-8): dashboard register and admin
// tenant-create both go through this helper so every tenant starts with
// identical defaults. Callers must already hold a withSystemContext wrap -
// the create crosses no tenant yet, so it runs in the bypass context.

export type ProvisionTenantInput = {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
};

export async function createTenantWithOwner(
  input: ProvisionTenantInput
): Promise<{ tenantId: string; userId: string }> {
  const passwordHash = await hashPassword(input.ownerPassword);
  const tenant = await prisma.tenant.create({
    data: {
      name: input.name,
      slug: input.slug,
      status: "ACTIVE",
      settings: { sourcePriority: ["MANUAL", "GOOGLE_SHEETS", "EXCEL", "MEMORY"] },
      users: {
        create: {
          email: input.ownerEmail,
          name: input.ownerName,
          role: "OWNER",
          canRunCampaigns: true,
          passwordHash,
        },
      },
    },
    select: { id: true, users: { select: { id: true } } },
  });
  return { tenantId: tenant.id, userId: tenant.users[0].id };
}
