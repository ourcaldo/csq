import type { NextApiRequest, NextApiResponse } from "next";
import type { Campaign } from "@prisma/client";
import { getAuthSession } from "@csq/core/lib/auth";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { canRunCampaigns } from "@csq/core/lib/campaign-access";
import { listTemplates } from "@csq/core/lib/message-templates";
import { campaignUpdateSchema, scheduleConfigSchema, type CampaignRow } from "@csq/core/types/campaign";

// Campaign detail/update/delete. PUT/DELETE only while DRAFT or PAUSED - an
// ACTIVE campaign is paused first, never edited live (plan 3.6). Access:
// OWNER, or STAFF with the campaign permission.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CampaignRow>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "campaigns"))) return;
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID kampanye tidak valid.");
    }

    const existing = await prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Kampanye tidak ditemukan.");

    if (req.method === "GET") {
      return res.status(200).json(apiOk(serialize(existing)));
    }

    if (!canRunCampaigns(session)) {
      return respondError(res, "PERMISSION_DENIED", "Tidak punya izin kampanye.");
    }

    if (req.method === "PUT") {
      if (existing.status !== "DRAFT" && existing.status !== "PAUSED") {
        return respondError(res, "VALIDATION_ERROR", "Kampanye aktif harus dijeda dulu sebelum diubah.");
      }
      const parsed = campaignUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
      }
      const input = parsed.data;
      const channel = await prisma.channel.findFirst({ where: { id: input.channelId, tenantId } });
      if (!channel) return respondError(res, "VALIDATION_ERROR", "Saluran tidak ditemukan.");

      // COR-2 (PRD 16): PUT resolves the content snapshot exactly like
      // create - sendKind/metaName/metaLanguage from the selected template,
      // never a silent no-op.
      let sendKind: "BODY" | "META_TEMPLATE" = "BODY";
      let body = input.body ?? "";
      let metaName: string | null = null;
      let metaLanguage: string | null = null;
      if (input.templateKey) {
        const templates = await listTemplates(tenantId);
        const template = templates.find((t) => t.key === input.templateKey);
        if (!template) {
          return respondError(res, "VALIDATION_ERROR", "Template tidak ditemukan.");
        }
        if (template.kind === "META") {
          if (!template.metaName) {
            return respondError(res, "VALIDATION_ERROR", "Template META belum punya nama template Meta.");
          }
          sendKind = "META_TEMPLATE";
          metaName = template.metaName;
          metaLanguage = template.metaLanguage ?? "id";
          if (!body.trim()) {
            return respondError(res, "VALIDATION_ERROR", "Isi juga teks pesan - dipakai di saluran Baileys dan pratinjau.");
          }
        } else {
          body = template.body;
        }
      }
      if (!body.trim() && input.imageIds.length === 0) {
        return respondError(res, "VALIDATION_ERROR", "Isi pesan atau tambahkan gambar.");
      }
      if (input.imageIds.length > 0) {
        const found = await prisma.mediaAsset.count({
          where: { tenantId, id: { in: input.imageIds } },
        });
        if (found !== input.imageIds.length) {
          return respondError(res, "VALIDATION_ERROR", "Ada gambar yang tidak dikenal.");
        }
      }

      const updated = await prisma.campaign.update({
        where: { id },
        data: {
          channelId: input.channelId,
          name: input.name,
          audience: input.audience,
          categoryIds: input.audience === "CATEGORY" ? input.categoryIds : [],
          tagIds: input.audience === "TAGS" ? input.tagIds : [],
          contactIds: input.audience === "MANUAL" ? input.contactIds : [],
          sendKind,
          body,
          metaName,
          metaLanguage,
          imageIds: input.imageIds,
          scheduleKind: input.scheduleKind,
          // Zod's .passthrough() leaves unknown keys, so JSON-round-trip the
          // config into a Prisma InputJsonValue without a cast (same pattern
          // as toJson in tools/execute.ts).
          scheduleConfig: JSON.parse(JSON.stringify(input.scheduleConfig)),
          delaySeconds: input.delaySeconds,
        },
      });
      await logHuman({
        tenantId,
        action: "campaign.update",
        entityType: "Campaign",
        entityId: id,
        beforeValue: existing,
        afterValue: updated,
      });
      return res.status(200).json(apiOk(serialize(updated)));
    }

    if (req.method === "DELETE") {
      await prisma.campaign.delete({ where: { id } });
      await logHuman({
        tenantId,
        action: "campaign.delete",
        entityType: "Campaign",
        entityId: id,
        beforeValue: existing,
      });
      return res.status(200).json(apiOk(serialize(existing)));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}

function serialize(c: Campaign): CampaignRow {
  return {
    id: c.id,
    channelId: c.channelId,
    name: c.name,
    status: c.status,
    audience: c.audience,
    categoryIds: c.categoryIds,
    tagIds: c.tagIds,
    contactIds: c.contactIds,
    sendKind: c.sendKind,
    body: c.body,
    imageIds: c.imageIds,
    metaName: c.metaName,
    metaLanguage: c.metaLanguage,
    scheduleKind: c.scheduleKind,
    scheduleConfig: scheduleConfigSchema.parse(c.scheduleConfig),
    delaySeconds: c.delaySeconds,
    nextRunAt: c.nextRunAt?.toISOString() ?? null,
    lastRunAt: c.lastRunAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}
