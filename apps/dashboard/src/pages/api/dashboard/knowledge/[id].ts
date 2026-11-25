import type { NextApiRequest, NextApiResponse } from "next";
import type { Knowledge } from "@prisma/client";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { knowledgeUpdateAnySchema } from "@csq/core/types/knowledge";
import { deleteEmbedding } from "@csq/core/lib/vector";
import { embedKnowledgeRow } from "@csq/core/lib/knowledge-embed";

// PRD 31: id addresses any row of an entry; PUT and DELETE operate on the
// whole group (rows sharing groupId). Explicit vector cleanup via
// lib/vector.ts, symmetric with the upserts - relying on the FK cascade alone
// would hide the cleanup.
async function dropVectors(ids: string[], tenantId: string): Promise<void> {
  for (const id of ids) {
    try {
      await deleteEmbedding("KnowledgeEmbedding", id, tenantId);
    } catch (err) {
      console.warn(`[knowledge] embedding cleanup skipped for ${id}:`, err);
    }
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Knowledge | { id: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID knowledge tidak valid.");
    }

    if (req.method === "GET") {
      const knowledge = await prisma.knowledge.findFirst({ where: { id, tenantId } });
      if (!knowledge) return respondError(res, "NOT_FOUND", "Knowledge tidak ditemukan.");
      return res.status(200).json(apiOk(knowledge));
    }

    if (req.method === "PUT") {
      if (!requirePermission(session, "pengetahuan.kelola")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah knowledge.");
      }
      const parsed = knowledgeUpdateAnySchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      // PRD 31: the id may be a row id or a group id (the list UI addresses
      // entries by groupId); either resolves to the group.
      const existing = await prisma.knowledge.findFirst({
        where: { tenantId, OR: [{ id }, { groupId: id }] },
      });
      if (!existing) return respondError(res, "NOT_FOUND", "Knowledge tidak ditemukan.");
      const groupId = existing.groupId;
      const before = await prisma.knowledge.findMany({
        where: { tenantId, groupId },
        orderBy: { createdAt: "asc" },
      });

      // FAQ pair-set replacement: update rows in place by position, create
      // new rows for added pairs, delete surplus rows.
      if (parsed.data.type === "FAQ" && "pairs" in parsed.data) {
        const category = parsed.data.category ?? before[0]?.category ?? null;
        const pairs = parsed.data.pairs;
        const touched: Knowledge[] = [];
        const removedIds: string[] = [];
        const after = await prisma.$transaction(async (tx) => {
          for (let i = 0; i < pairs.length; i++) {
            const row = before[i];
            const updated = row
              ? await tx.knowledge.update({
                  where: { id: row.id },
                  data: { type: "FAQ", title: pairs[i].q, content: pairs[i].a, category },
                })
              : await tx.knowledge.create({
                  data: {
                    tenantId,
                    type: "FAQ",
                    title: pairs[i].q,
                    content: pairs[i].a,
                    category,
                    groupId,
                  },
                });
            touched.push(updated);
          }
          const surplus = before.slice(pairs.length);
          if (surplus.length > 0) {
            await tx.knowledge.deleteMany({
              where: { tenantId, id: { in: surplus.map((r) => r.id) } },
            });
            for (const row of surplus) removedIds.push(row.id);
          }
          return touched;
        });
        await logHuman({
          tenantId,
          action: "knowledge.update",
          entityType: "Knowledge",
          entityId: groupId,
          beforeValue: before,
          afterValue: after,
        });
        await dropVectors(removedIds, tenantId);
        for (const row of after) {
          await embedKnowledgeRow(row, tenantId);
        }
        return res.status(200).json(apiOk(after[0]));
      }

      // Legacy single-row update. If the entry leaves FAQ (or the client edits
      // a group row without the pairs shape), collapse the group to this row.
      const updated = await prisma.knowledge.update({
        where: { id },
        data: { ...parsed.data, category: parsed.data.category ?? existing.category },
      });
      const siblings = before.filter((r) => r.id !== id);
      if (siblings.length > 0 && updated.type !== "FAQ") {
        await prisma.knowledge.deleteMany({
          where: { tenantId, id: { in: siblings.map((r) => r.id) } },
        });
        await dropVectors(
          siblings.map((r) => r.id),
          tenantId
        );
      }
      await logHuman({
        tenantId,
        action: "knowledge.update",
        entityType: "Knowledge",
        entityId: groupId,
        beforeValue: before,
        afterValue: updated,
      });
      // Re-embed on update so the vector reflects new text. Best-effort
      // graceful degradation - the update is already persisted above.
      await embedKnowledgeRow(updated, tenantId);
      return res.status(200).json(apiOk(updated));
    }

    if (req.method === "DELETE") {
      if (!requirePermission(session, "pengetahuan.kelola")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menghapus knowledge.");
      }
      const existing = await prisma.knowledge.findFirst({
        where: { tenantId, OR: [{ id }, { groupId: id }] },
      });
      if (!existing) return respondError(res, "NOT_FOUND", "Knowledge tidak ditemukan.");
      const groupId = existing.groupId;
      const rows = await prisma.knowledge.findMany({ where: { tenantId, groupId } });
      await prisma.knowledge.deleteMany({ where: { tenantId, groupId } });
      await dropVectors(
        rows.map((r) => r.id),
        tenantId
      );
      await logHuman({
        tenantId,
        action: "knowledge.delete",
        entityType: "Knowledge",
        entityId: groupId,
        beforeValue: rows,
      });
      return res.status(200).json(apiOk({ id: groupId }));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
