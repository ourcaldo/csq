import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { assignRequestId } from "@csq/core/lib/request-id";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { HttpError, respondError } from "@csq/core/lib/queries";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import {
  pipelineDealsQuerySchema,
  createDealRequestSchema,
  type PipelineDealsResult,
  type CreateDealResult,
} from "@csq/core/lib/api-contract";
import { getOrCreatePipeline, listDealsForKanban } from "@csq/core/lib/pipeline";
import { createLead } from "@csq/core/lib/inbox";
import { requireTenantFeature } from "../_guard";

// GET  /api/v1/pipeline/deals (PRD 25) - the tenant's board, paged, with the
// same filters as the dashboard (stage name, assignee, tag, chat-activity
// range). POST /api/v1/pipeline/deals - create a lead, same as Tambah Lead.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PipelineDealsResult | CreateDealResult>>
) {
  assignRequestId(req, res);
  const auth = await requireTenantFeature(req, res, "pipeline", "pipeline-deals");
  if (!auth) return;

  return withTenantContext(auth.tenantId, async () => {
    if (req.method === "GET") {
      const parsed = pipelineDealsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json(
            apiError(
              "VALIDATION_ERROR",
              parsed.error.issues[0]?.message ?? "Invalid query parameters"
            )
          );
      }
      const { stage, assignee, tag, from, to, page, pageSize } = parsed.data;
      const pipeline = await getOrCreatePipeline(auth.tenantId);
      let stageId: string | undefined;
      if (stage) {
        const found = pipeline.stages.find(
          (s) => s.name.toLowerCase() === stage.toLowerCase()
        );
        if (!found) {
          return res
            .status(404)
            .json(apiError("NOT_FOUND", `Stage "${stage}" not found`));
        }
        stageId = found.id;
      }
      let tagId: string | undefined;
      if (tag) {
        const tagRow = await prisma.tag.findFirst({
          where: { tenantId: auth.tenantId, name: tag },
          select: { id: true },
        });
        if (!tagRow) {
          return res.status(404).json(apiError("NOT_FOUND", `Tag "${tag}" not found`));
        }
        tagId = tagRow.id;
      }
      const result = await listDealsForKanban({
        tenantId: auth.tenantId,
        stageId,
        assigneeUserId: assignee,
        tagId,
        from,
        to,
        page: page ?? 1,
        pageSize: pageSize ?? 50,
      });
      const items = result.items.map((d) => ({
        id: d.id,
        conversationId: d.conversationId,
        value: d.value,
        stage: {
          id: d.stage.id,
          name: d.stage.name,
          kind: d.stage.kind,
          order: d.stage.order,
        },
        conversation: {
          id: d.conversation.id,
          customerPhone: d.conversation.customerPhone,
          lastMessageAt: d.conversation.lastMessageAt?.toISOString() ?? null,
          contact: d.conversation.contact
            ? {
                id: d.conversation.contact.id,
                name: d.conversation.contact.name,
                phone: d.conversation.contact.phone,
                source: d.conversation.contact.source,
              }
            : null,
          assignee: d.conversation.assignee
            ? {
                id: d.conversation.assignee.id,
                name: d.conversation.assignee.name,
                email: d.conversation.assignee.email,
              }
            : null,
          tags: d.conversation.tags.map((t) => ({
            tag: { id: t.tag.id, name: t.tag.name },
          })),
        },
      }));
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
      const parsed = createDealRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json(
            apiError(
              "VALIDATION_ERROR",
              parsed.error.issues[0]?.message ?? "Invalid request body"
            )
          );
      }
      let stageName: string;
      if (parsed.data.stage) {
        const pipeline = await getOrCreatePipeline(auth.tenantId);
        const found = pipeline.stages.find(
          (s) => s.name.toLowerCase() === parsed.data.stage!.toLowerCase()
        );
        if (!found) {
          return res
            .status(404)
            .json(apiError("NOT_FOUND", `Stage "${parsed.data.stage}" not found`));
        }
        stageName = found.name;
      } else {
        const pipeline = await getOrCreatePipeline(auth.tenantId);
        const first =
          pipeline.stages.find((s) => s.kind === "OPENING") ?? pipeline.stages[0];
        // getOrCreatePipeline always seeds stages; first is defined here.
        if (!first) {
          return res
            .status(500)
            .json(apiError("INTERNAL_ERROR", "The tenant has no pipeline stages"));
        }
        stageName = first.name;
      }
      try {
        const lead = await createLead({
          tenantId: auth.tenantId,
          phone: parsed.data.phone,
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          stageName,
          ...(parsed.data.value !== undefined ? { value: parsed.data.value } : {}),
          ...(auth.kind === "JWT_USER" ? { createdByUserId: auth.userId } : {}),
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
        return res.status(500).json(apiError("INTERNAL_ERROR", "Failed to create lead"));
      }
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  });
}
