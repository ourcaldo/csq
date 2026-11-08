import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { generateApiToken } from "@csq/core/lib/api-tokens";
import { logAction } from "@csq/core/lib/audit";

// Tenant API-key management for the /api/v1 token realm (PRD 23C Phase 7).
// OWNER-only, tenant-scoped. The plaintext token is returned exactly ONCE,
// at mint - afterwards only its sha256 hash exists and the prefix identifies
// it. UI page comes later; the routes are usable today.

const mintSchema = z.object({ name: z.string().min(1).max(64) });

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type ListKeysResult = { items: KeyRow[] };
export type MintResult = {
  id: string;
  name: string;
  prefix: string;
  token: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListKeysResult | MintResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner.");
  }
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const items: KeyRow[] = await prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });
    return res.status(200).json(apiOk({ items }));
  }

  if (req.method === "POST") {
    const parsed = mintSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const { token, hash, prefix } = generateApiToken();
    const key = await prisma.apiKey.create({
      data: { tenantId, name: parsed.data.name, tokenHash: hash, prefix },
    });
    await logAction({
      tenantId,
      agentId: null,
      action: "apikey.create",
      entityType: "ApiKey",
      entityId: key.id,
      approvalStatus: "NONE",
      customerPhone: undefined,
      afterValue: { name: parsed.data.name, prefix },
    });
    return res
      .status(201)
      .json(apiOk({ id: key.id, name: key.name, prefix, token }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
