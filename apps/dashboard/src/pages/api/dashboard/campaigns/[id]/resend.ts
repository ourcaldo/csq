import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { logAction } from "@csq/core/lib/audit";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Resend the FAILED recipients of one run (PRD 28 Part D2, owner request
// 2026-11-21): POST /api/dashboard/campaigns/[id]/resend?runId=<run>.
// OWNER-only. Creates a NEW run on the same campaign containing only the
// run's FAILED rows (SKIPPED are NOT resent - window skips are correct
// behavior). Delivery honors the current channel rules at fire time
// (delay, window, provider) like any campaign send; the campaign must be
// DRAFT or PAUSED is fine - the resend run drains independently of the
// campaign's schedule.

type ResendResult = {
  runId: string;
  queued: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ResendResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "campaigns"))) return;
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "POST") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }
    if (!requirePermission(session, "kampanye.kelola")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengirim ulang.");
    }

    const { id, runId } = req.query;
    if (typeof id !== "string" || typeof runId !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID kampanye atau sesi tidak valid.");
    }

    const campaign = await prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!campaign) return respondError(res, "NOT_FOUND", "Kampanye tidak ditemukan.");

    const run = await prisma.campaignRun.findFirst({
      where: { id: runId, campaignId: campaign.id, tenantId },
    });
    if (!run) return respondError(res, "NOT_FOUND", "Sesi kirim tidak ditemukan.");

    // Only the FAILED rows of that run - SKIPPED stays skipped.
    const failed = await prisma.campaignMessage.findMany({
      where: { runId: run.id, status: "FAILED" },
      orderBy: { scheduledFor: "asc" },
      take: 500,
    });
    if (failed.length === 0) {
      return respondError(res, "VALIDATION_ERROR", "Tidak ada pesan gagal untuk dikirim ulang pada sesi ini.");
    }

    const now = new Date();
    const newRun = await prisma.campaignRun.create({
      data: { tenantId, campaignId: campaign.id },
    });
    await prisma.campaignMessage.createMany({
      data: failed.map((m, i) => ({
        tenantId,
        runId: newRun.id,
        contactId: m.contactId,
        phone: m.phone,
        scheduledFor: new Date(now.getTime() + i * campaign.delaySeconds * 1000),
      })),
    });

    await logAction({
      tenantId,
      agentId: null,
      action: "campaign.resend_failed",
      entityType: "CampaignRun",
      entityId: newRun.id,
      approvalStatus: "NONE",
      afterValue: { sourceRunId: run.id, campaignId: campaign.id, queued: failed.length },
    });

    return res.status(201).json(apiOk({ runId: newRun.id, queued: failed.length }));
  });
}
