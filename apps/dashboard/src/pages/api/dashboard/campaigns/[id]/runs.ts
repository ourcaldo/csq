import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError, paginate } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import type { CampaignMessageRow, CampaignRunRow } from "@csq/core/types/campaign";

// Run history for a campaign (plan 3.6): GET without a runId lists the runs
// with their counts; GET ?runId= returns that run's per-recipient log, paged.
// Read access: OWNER, or STAFF with the campaign permission.

// The engine writes counts as {total,sent,failed,skipped}; parse the Json
// column at the boundary (no `as`) instead of trusting the raw column type.
const runCountsSchema = z.object({
  total: z.number().optional(),
  sent: z.number().optional(),
  failed: z.number().optional(),
  skipped: z.number().optional(),
});
type RunCounts = z.infer<typeof runCountsSchema>;

function parseCounts(raw: unknown): RunCounts | null {
  const parsed = runCountsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ runs: Array<CampaignRunRow> } | { run: CampaignRunRow }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID kampanye tidak valid.");
  }

  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!campaign) return respondError(res, "NOT_FOUND", "Kampanye tidak ditemukan.");

  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  if (runId) {
    const { skip, take } = paginate(req.query);
    const run = await prisma.campaignRun.findFirst({
      where: { id: runId, campaignId: campaign.id, tenantId },
    });
    if (!run) return respondError(res, "NOT_FOUND", "Riwayat kirim tidak ditemukan.");
    const messages = await prisma.campaignMessage.findMany({
      where: { runId: run.id },
      orderBy: { scheduledFor: "asc" },
      skip,
      take,
    });
    return res.status(200).json(
      apiOk({
        run: {
          id: run.id,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          counts: parseCounts(run.counts),
          messages: messages.map((m) => ({
            id: m.id,
            phone: m.phone,
            status: m.status === "SENT" ? "SENT" : m.status === "FAILED" ? "FAILED" : m.status === "SKIPPED" ? "SKIPPED" : "PENDING",
            scheduledFor: m.scheduledFor.toISOString(),
            sentAt: m.sentAt?.toISOString() ?? null,
            reason: m.reason,
          })),
        },
      })
    );
  }

  const runs = await prisma.campaignRun.findMany({
    where: { campaignId: campaign.id, tenantId },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return res.status(200).json(
    apiOk({
      runs: runs.map((r) => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        counts: parseCounts(r.counts),
      })),
    })
  );
}
