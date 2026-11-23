import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import {
  requireTenant,
  respondError,
  strQuery,
  paginate,
  HttpError,
} from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { listDealsForKanban } from "@csq/core/lib/pipeline";
import { createLead } from "@csq/core/lib/inbox";
import { getPnForLid } from "@csq/core/lib/baileys-auth-db";
import type {
  PipelineBoardResult,
  PipelineDeal,
} from "@csq/core/types/pipeline";

// GET /api/dashboard/pipeline/deals - one stage's cards for the kanban board:
// serialized PipelineDeal rows (last message, unread, tags, value) + the
// stage's total value across the whole filtered set.
// POST /api/dashboard/pipeline/deals - Tambah Lead: create or reuse the
// conversation for a phone number, place it on a stage, set its value.

const createLeadSchema = z.object({
  phone: z.string().min(8).max(25),
  name: z.string().max(120).optional(),
  stage: z.string().min(1),
  value: z.number().int().min(0).max(1_000_000_000_000).optional(),
});

type CreateResult = {
  conversationId: string;
  dealId: string;
  created: boolean;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PipelineBoardResult | CreateResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "pipeline"))) return;
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const { page, pageSize } = paginate(req.query);
      const result = await listDealsForKanban({
        tenantId,
        stageId: strQuery(req.query, "stage"),
        assigneeUserId: strQuery(req.query, "assignee"),
        tagId: strQuery(req.query, "tag"),
        from: strQuery(req.query, "from"),
        to: strQuery(req.query, "to"),
        page,
        pageSize,
      });

      // Unread badges: one grouped count over the page's conversations, using
      // this user's read watermark per conversation (no per-card query).
      const conversationIds = result.items.map((d) => d.conversation.id);
      const reads = conversationIds.length
        ? await prisma.conversationRead.findMany({
            where: {
              tenantId,
              userId: session.user.id,
              conversationId: { in: conversationIds },
            },
            select: { conversationId: true, lastReadAt: true },
          })
        : [];
      const watermark = new Map(
        reads.map((r) => [r.conversationId, r.lastReadAt])
      );
      const unreadConditions: Prisma.MessageWhereInput[] = conversationIds.map(
        (id) => {
          const lastReadAt = watermark.get(id);
          return lastReadAt
            ? { conversationId: id, createdAt: { gt: lastReadAt } }
            : { conversationId: id };
        }
      );
      const grouped = unreadConditions.length
        ? await prisma.message.groupBy({
            by: ["conversationId"],
            where: {
              tenantId,
              direction: "INBOUND",
              OR: unreadConditions,
            },
            _count: { id: true },
          })
        : [];
      const unread = new Map(
        grouped.map((g) => [g.conversationId, g._count.id])
      );

      const items: PipelineDeal[] = await Promise.all(
        result.items.map(async (deal) => {
          const c = deal.conversation;
          let customerPhoneDisplay = c.customerPhone;
          if (customerPhoneDisplay.includes("@lid")) {
            customerPhoneDisplay =
              (await getPnForLid(c.channelId, customerPhoneDisplay)) ??
              customerPhoneDisplay.split("@")[0];
          } else if (customerPhoneDisplay.includes("@s.whatsapp.net")) {
            customerPhoneDisplay = customerPhoneDisplay.split("@")[0];
          }
          const last = c.messages[0];
          return {
            id: deal.id,
            conversationId: c.id,
            value: deal.value,
            stage: deal.stage,
            unreadCount: unread.get(c.id) ?? 0,
            conversation: {
              id: c.id,
              customerPhone: c.customerPhone,
              customerPhoneDisplay,
              lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
              contact: c.contact
                ? {
                    id: c.contact.id,
                    name: c.contact.name,
                    phone: c.contact.phone,
                    email: c.contact.email,
                    notes: c.contact.notes,
                    source: c.contact.source,
                  }
                : null,
              assignee: c.assignee
                ? {
                    id: c.assignee.id,
                    name: c.assignee.name,
                    email: c.assignee.email,
                  }
                : null,
              channel: { provider: c.channel.provider },
              tags: c.tags.map((t) => ({ tag: t.tag })),
              lastMessage: last
                ? {
                    body: last.body,
                    senderType: last.senderType,
                    kind: last.kind,
                  }
                : null,
            },
          };
        })
      );

      return res.status(200).json(
        apiOk({
          items,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
        })
      );
    }

    if (req.method === "POST") {
      if (!requirePermission(session, "pipeline.kelola")) {
        return respondError(
          res,
          "PERMISSION_DENIED",
          "Hanya owner/staff yang dapat menambah lead."
        );
      }
      const parsed = createLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      try {
        const lead = await createLead({
          tenantId,
          phone: parsed.data.phone,
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          stageName: parsed.data.stage,
          ...(parsed.data.value !== undefined
            ? { value: parsed.data.value }
            : {}),
          createdByUserId: session.user.id,
        });
        return res.status(200).json(
          apiOk({
            conversationId: lead.conversation.id,
            dealId: lead.dealId,
            created: lead.created,
          })
        );
      } catch (err) {
        if (err instanceof HttpError) {
          return respondError(res, err.code, err.message);
        }
        return respondError(res, "INTERNAL_ERROR", "Gagal menambah lead.");
      }
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
