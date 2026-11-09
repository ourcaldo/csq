import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { createTenantWithOwner } from "@csq/core/lib/provision-tenant";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { registerSchema } from "@csq/core/types/auth";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Registration creates a Tenant + its OWNER User in one transactional nested
// write (PRD FR-AU-005). Slug is suffixed to avoid collisions on the @unique.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ tenantId: string }>>
) {
  // No session yet: registration creates a cross-tenant Tenant + OWNER user,
  // so it runs in the bypass context (PRD 16 SEC-1).
  return withSystemContext(async () => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input"));
    }

    const { businessName, name, email, password } = parsed.data;
    const lowerEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existing) {
      return res.status(409).json(apiError("VALIDATION_ERROR", "Email sudah terdaftar"));
    }

    const slug = `${slugify(businessName)}-${randomUUID().slice(0, 4)}`;

    const { tenantId } = await createTenantWithOwner({
      name: businessName,
      slug,
      ownerEmail: lowerEmail,
      ownerName: name,
      ownerPassword: password,
    });

    return res.status(201).json(apiOk({ tenantId }));
  });
}
