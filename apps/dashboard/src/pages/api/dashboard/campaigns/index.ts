import type { NextApiRequest, NextApiResponse } from "next";
import type { Campaign } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { canRunCampaigns } from "@/lib/campaign-access";
import { listTemplates } from "@/lib/message-templates";
import {
  campaignCreateSchema,
  scheduleConfigSchema,
  type CampaignRow,
} from "@/types/campaign";

// Campaign list + create (feature plan 2026-11-01, sections 3.6).
// Access: OWNER, or STAFF with the campaign permission (decision 2.2).

type ListResult = { items: CampaignRow[]; total: number; page: number; pageSize: number };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CampaignRow | { items: CampaignRow[] } | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const [rows, total] = await Promise.all([
      prisma.campaign.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.campaign.count({ where: { tenantId } }),
    ]);
    return res.status(200).json(
      apiOk({ items: rows.map(serialize), total, page: 1, pageSize: rows.length })
    );
  }

  if (req.method === "POST") {
    if (!canRunCampaigns(session)) {
      return respondError(res, "PERMISSION_DENIED", "Tidak punya izin kampanye.");
    }
    const parsed = campaignCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
    }
    const input = parsed.data;

    // Channel must belong to this tenant (the engine re-checks CONNECTED at
    // fire/delivery - a temporarily disconnected channel must not block save).
    const channel = await prisma.channel.findFirst({
      where: { id: input.channelId, tenantId },
    });
    if (!channel) {
      return respondError(res, "VALIDATION_ERROR", "Saluran tidak ditemukan.");
    }

    // Audience references must belong to this tenant - a foreign id would
    // silently match nothing, so reject it up front.
    if (input.audience === "CATEGORY" && input.categoryIds.length > 0) {
      const found = await prisma.category.count({
        where: { tenantId, id: { in: input.categoryIds } },
      });
      if (found !== input.categoryIds.length) {
        return respondError(res, "VALIDATION_ERROR", "Ada kategori yang tidak dikenal.");
      }
    }
    if (input.audience === "TAGS" && input.tagIds.length > 0) {
      const found = await prisma.tag.count({
        where: { tenantId, id: { in: input.tagIds } },
      });
      if (found !== input.tagIds.length) {
        return respondError(res, "VALIDATION_ERROR", "Ada tag yang tidak dikenal.");
      }
    }
    if (input.audience === "MANUAL" && input.contactIds.length > 0) {
      const found = await prisma.contact.count({
        where: { tenantId, id: { in: input.contactIds } },
      });
      if (found !== input.contactIds.length) {
        return respondError(res, "VALIDATION_ERROR", "Ada kontak yang tidak dikenal.");
      }
    }

    // Content snapshot (plan 3.2 consequence 1): resolve at save time.
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
        // The body is still required: it is the Baileys text and the preview
        // (plan 3.2 consequence 1).
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

    const campaign = await prisma.campaign.create({
      data: {
        tenantId,
        channelId: input.channelId,
        name: input.name,
        status: "DRAFT",
        audience: input.audience,
        categoryIds: input.audience === "CATEGORY" ? input.categoryIds : [],
        tagIds: input.audience === "TAGS" ? input.tagIds : [],
        contactIds: input.audience === "MANUAL" ? input.contactIds : [],
        sendKind,
        body,
        imageIds: input.imageIds,
        metaName,
        metaLanguage,
        scheduleKind: input.scheduleKind,
        // JSON-round-trip narrows the passthrough schema into a Prisma
        // InputJsonValue without a cast (same pattern as [id].ts).
        scheduleConfig: JSON.parse(JSON.stringify(input.scheduleConfig)),
        delaySeconds: input.delaySeconds,
      },
    });
    await logHuman({
      tenantId,
      action: "campaign.create",
      entityType: "Campaign",
      entityId: campaign.id,
      afterValue: { name: campaign.name, audience: campaign.audience, scheduleKind: campaign.scheduleKind },
    });
    return res.status(201).json(apiOk(serialize(campaign)));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}

// Serialized client shape (Prisma Date → ISO via JSON).
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
