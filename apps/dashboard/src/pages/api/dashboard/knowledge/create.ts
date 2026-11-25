import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";
import type { Knowledge } from "@prisma/client";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { knowledgeCreateAnySchema } from "@csq/core/types/knowledge";
import { embedKnowledgeRow } from "@csq/core/lib/knowledge-embed";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Knowledge>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "POST") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    if (!requirePermission(session, "pengetahuan.kelola")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat membuat knowledge.");
    }

    const parsed = knowledgeCreateAnySchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }

    // PRD 31: multi-pair FAQ entry = one row per Q&A pair sharing a groupId,
    // so every pair keeps its own embedding and knowledge.search matches the
    // specific pair. Single entries keep one row.
    if (parsed.data.type === "FAQ" && "pairs" in parsed.data) {
      const groupId = randomUUID();
      const rows = await prisma.$transaction(
        parsed.data.pairs.map((p) =>
          prisma.knowledge.create({
            data: {
              tenantId,
              type: "FAQ",
              title: p.q,
              content: p.a,
              category: parsed.data.category ?? null,
              groupId,
            },
          })
        )
      );
      await logHuman({
        tenantId,
        action: "knowledge.create",
        entityType: "Knowledge",
        entityId: groupId,
        afterValue: rows,
      });
      for (const row of rows) {
        await embedKnowledgeRow(row, tenantId);
      }
      return res.status(200).json(apiOk(rows[0]));
    }

    const knowledge = await prisma.knowledge.create({
      data: {
        type: parsed.data.type,
        title: parsed.data.title,
        content: parsed.data.content,
        category: parsed.data.category ?? null,
        groupId: randomUUID(),
        tenantId,
      },
    });
    await logHuman({
      tenantId,
      action: "knowledge.create",
      entityType: "Knowledge",
      entityId: knowledge.id,
      afterValue: knowledge,
    });
    await embedKnowledgeRow(knowledge, tenantId);
    return res.status(200).json(apiOk(knowledge));
  });
}
