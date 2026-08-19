import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { registerSchema } from "@/types/auth";
import { apiError, apiOk, type ApiResponse } from "@/types/api";
import { provisionCell } from "@/services/openclaw-cell";

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

  const passwordHash = await hashPassword(password);
  const slug = `${slugify(businessName)}-${randomUUID().slice(0, 4)}`;

  const tenant = await prisma.tenant.create({
    data: {
      name: businessName,
      slug,
      settings: { sourcePriority: ["MANUAL", "GOOGLE_SHEETS", "EXCEL", "MEMORY"] },
      users: {
        create: { email: lowerEmail, name, passwordHash, role: "OWNER" },
      },
    },
  });

  // Provision the tenant's isolated OpenClaw cell (PRD §5/§26). Fire-and-
  // forget so registration returns immediately; provisionCell updates
  // cellStatus (PENDING -> PROVISIONED | FAILED) on the Tenant row. In
  // dev (shared) this is a fast DB write; in production (fleet) it spawns
  // a Gateway container for the new store.
  void provisionCell(tenant).catch((err) => {
    console.error(
      `[register] OpenClaw cell provisioning failed for tenant ${tenant.id}:`,
      err
    );
  });

  return res.status(201).json(apiOk({ tenantId: tenant.id }));
}
