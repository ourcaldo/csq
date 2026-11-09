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
import { nextCampaignOccurrence, scheduleTz, type ScheduleConfig } from "@csq/core/lib/campaign-schedule";
import { scheduleConfigSchema, type CampaignRow } from "@csq/core/types/campaign";

// Activate (DRAFT/PAUSED → ACTIVE) and pause (ACTIVE → PAUSED).
// Activation computes the first nextRunAt from the schedule; ONCE requires a
// future startAt. Pause holds in-flight PENDING rows - they resume on activate.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CampaignRow>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "campaigns"))) return;
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (!canRunCampaigns(session)) {
      return respondError(res, "PERMISSION_DENIED", "Tidak punya izin kampanye.");
    }

    const { id, action } = req.query;
    if (typeof id !== "string" || (action !== "activate" && action !== "pause")) {
      return respondError(res, "VALIDATION_ERROR", "Permintaan tidak valid.");
    }

    const existing = await prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Kampanye tidak ditemukan.");

    if (action === "pause") {
      if (existing.status !== "ACTIVE") {
        return respondError(res, "VALIDATION_ERROR", "Kampanye tidak sedang aktif.");
      }
      const updated = await prisma.campaign.update({ where: { id }, data: { status: "PAUSED" } });
      await logHuman({
        tenantId,
        action: "campaign.pause",
        entityType: "Campaign",
        entityId: id,
        beforeValue: existing,
        afterValue: updated,
      });
      return res.status(200).json(apiOk(serialize(updated)));
    }

    // activate
    if (existing.status !== "DRAFT" && existing.status !== "PAUSED") {
      return respondError(res, "VALIDATION_ERROR", "Kampanye sudah aktif.");
    }
    const channel = await prisma.channel.findUnique({ where: { id: existing.channelId } });
    if (!channel || channel.status !== "CONNECTED") {
      return respondError(res, "VALIDATION_ERROR", "Saluran belum terhubung - sambungkan dulu di halaman Saluran.");
    }
    const now = new Date();
    const config = existing.scheduleConfig as ScheduleConfig;
    let next: Date | null;
    if (existing.scheduleKind === "ONCE") {
      next = config.startAt ? new Date(config.startAt) : null;
      if (!next || next.getTime() <= now.getTime()) {
        return respondError(res, "VALIDATION_ERROR", "Waktu kampanye sekali jalan harus di masa depan.");
      }
    } else {
      next = nextCampaignOccurrence(existing.scheduleKind, config, now, scheduleTz());
      if (!next) {
        return respondError(res, "VALIDATION_ERROR", "Jadwal tidak valid.");
      }
    }
    const updated = await prisma.campaign.update({
      where: { id },
      data: { status: "ACTIVE", nextRunAt: next },
    });
    await logHuman({
      tenantId,
      action: "campaign.activate",
      entityType: "Campaign",
      entityId: id,
      beforeValue: existing,
      afterValue: updated,
    });
    return res.status(200).json(apiOk(serialize(updated)));
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
