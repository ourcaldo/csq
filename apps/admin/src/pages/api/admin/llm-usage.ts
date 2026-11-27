import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin } from "@/lib/admin-auth";
import { systemRaw, withSystemContext } from "@csq/core/lib/tenant-context";

// LLM usage and cost (PRD 33): platform aggregates for /admin/llm-usage.
// Cost figures come from the per-row write-time snapshots (costUsd,
// fxRateIdrPerUsd, costIdr); later price or FX edits never rewrite them.

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function nextMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

function resolveMonth(param: unknown): { month: string; start: Date; end: Date } | null {
  let start: Date;
  if (typeof param === "string" && param !== "") {
    if (!MONTH_RE.test(param)) return null;
    start = new Date(`${param}-01T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return null;
  } else {
    const now = new Date();
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return { month: start.toISOString().slice(0, 7), start, end: nextMonthStart(start) };
}

const num = (v: Prisma.Decimal | number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === "number" ? v : Number(v.toString());

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {
    if (req.method !== "GET") {
      return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed."));
    }

    const w = resolveMonth(req.query.month);
    if (!w) {
      return res.status(400).json(apiError("VALIDATION_ERROR", "month must be YYYY-MM."));
    }
    const monthWhere = { createdAt: { gte: w.start, lt: w.end } };
    const now = new Date();
    const fxStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));

    const [
      firstUsage,
      totals,
      unpricedCalls,
      missingFxCalls,
      repliesCount,
      agentCost,
      modelRows,
      modelUnpricedRows,
      dailyRows,
      tenants,
      replyRows,
      tenantUsageRows,
      tenantAgentRows,
      tenantUnpricedRows,
      prices,
      fxRecent,
      fxCurrent,
    ] = await Promise.all([
      prisma.llmUsage.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.llmUsage.aggregate({
        where: monthWhere,
        _count: { _all: true },
        _sum: { promptTokens: true, completionTokens: true, costUsd: true, costIdr: true },
      }),
      prisma.llmUsage.count({ where: { ...monthWhere, costUsd: null } }),
      prisma.llmUsage.count({
        where: { ...monthWhere, costUsd: { not: null }, costIdr: null },
      }),
      prisma.aiCreditUsage.count({ where: { source: "REPLY", ...monthWhere } }),
      prisma.llmUsage.aggregate({
        where: { ...monthWhere, source: "AGENT_CALL" },
        _sum: { costIdr: true },
      }),
      prisma.llmUsage.groupBy({
        by: ["model"],
        where: monthWhere,
        _count: true,
        _sum: { promptTokens: true, completionTokens: true, costUsd: true, costIdr: true },
      }),
      prisma.llmUsage.groupBy({
        by: ["model"],
        where: { ...monthWhere, costUsd: null },
        _count: true,
      }),
      systemRaw(
        prisma.$queryRaw<{ day: Date; cost: string }[]>`
          SELECT date_trunc('day', "createdAt") AS day, COALESCE(SUM("costIdr"), 0) AS cost
          FROM "LlmUsage"
          WHERE "createdAt" >= ${w.start} AND "createdAt" < ${w.end}
          GROUP BY 1
          ORDER BY 1
        `
      ),
      prisma.tenant.findMany({
        orderBy: { createdAt: "asc" },
        include: { plan: { select: { name: true, priceIdr: true } } },
      }),
      prisma.aiCreditUsage.groupBy({
        by: ["tenantId"],
        where: { source: "REPLY", ...monthWhere },
        _count: true,
      }),
      prisma.llmUsage.groupBy({
        by: ["tenantId"],
        where: monthWhere,
        _count: true,
        _sum: { costIdr: true },
      }),
      prisma.llmUsage.groupBy({
        by: ["tenantId"],
        where: { ...monthWhere, source: "AGENT_CALL" },
        _sum: { costIdr: true },
      }),
      prisma.llmUsage.groupBy({
        by: ["tenantId"],
        where: { ...monthWhere, costUsd: null },
        _count: true,
      }),
      prisma.llmModelPrice.findMany({ orderBy: { model: "asc" } }),
      prisma.fxRate.findMany({ where: { date: { gte: fxStart } }, orderBy: { date: "desc" } }),
      prisma.fxRate.findFirst({ orderBy: { date: "desc" } }),
    ]);

    const totalCostIdr = num(totals._sum.costIdr);

    const dailyMap = new Map(dailyRows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.cost)]));
    const daily: { date: string; costIdr: number }[] = [];
    for (let d = new Date(w.start); d < w.end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      daily.push({ date: key, costIdr: dailyMap.get(key) ?? 0 });
    }

    const priceModels = new Set(prices.map((p) => p.model));
    const unpricedByModel = new Map(modelUnpricedRows.map((r) => [r.model, r._count]));
    const models = modelRows
      .map((r) => ({
        model: r.model,
        calls: r._count,
        promptTokens: num(r._sum.promptTokens),
        completionTokens: num(r._sum.completionTokens),
        costUsd: num(r._sum.costUsd),
        costIdr: num(r._sum.costIdr),
        sharePct: totalCostIdr > 0 ? (num(r._sum.costIdr) / totalCostIdr) * 100 : 0,
        hasPrice: priceModels.has(r.model),
        unpricedCalls: unpricedByModel.get(r.model) ?? 0,
      }))
      .sort((a, b) => b.costIdr - a.costIdr);

    const repliesByTenant = new Map(replyRows.map((r) => [r.tenantId, r._count]));
    const usageByTenant = new Map(tenantUsageRows.map((r) => [r.tenantId, r]));
    const agentByTenant = new Map(tenantAgentRows.map((r) => [r.tenantId, num(r._sum.costIdr)]));
    const unpricedByTenant = new Map(tenantUnpricedRows.map((r) => [r.tenantId, r._count]));
    const tenantItems = tenants.map((t) => {
      const replies = repliesByTenant.get(t.id) ?? 0;
      const usage = usageByTenant.get(t.id);
      const costIdr = num(usage?._sum.costIdr);
      const planPrice = t.plan?.priceIdr ?? null;
      return {
        tenantId: t.id,
        tenantName: t.name,
        planName: t.plan?.name ?? null,
        planPriceIdr: planPrice,
        replies,
        calls: usage?._count ?? 0,
        costIdr,
        costPerReply: replies > 0 ? (agentByTenant.get(t.id) ?? 0) / replies : null,
        costPercentOfPlan: planPrice !== null ? (costIdr / planPrice) * 100 : null,
        unpricedCalls: unpricedByTenant.get(t.id) ?? 0,
      };
    });

    const fxDto = (r: { date: Date; usdIdr: Prisma.Decimal; source: string }) => ({
      date: r.date.toISOString().slice(0, 10),
      usdIdr: r.usdIdr.toString(),
      source: r.source,
    });

    return res.status(200).json(
      apiOk({
        month: w.month,
        monthStart: w.start.toISOString(),
        monthEnd: w.end.toISOString(),
        firstRecordedAt: firstUsage ? firstUsage.createdAt.toISOString() : null,
        totals: {
          calls: totals._count._all,
          promptTokens: num(totals._sum.promptTokens),
          completionTokens: num(totals._sum.completionTokens),
          costUsd: num(totals._sum.costUsd),
          costIdr: totalCostIdr,
          unpricedCalls,
          missingFxCalls,
          replies: repliesCount,
          costPerReply: repliesCount > 0 ? num(agentCost._sum.costIdr) / repliesCount : null,
        },
        daily,
        models,
        tenants: tenantItems,
        prices: prices.map((p) => ({
          model: p.model,
          inputUsdPer1M: p.inputUsdPer1M.toString(),
          outputUsdPer1M: p.outputUsdPer1M.toString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        fx: {
          current: fxCurrent ? fxDto(fxCurrent) : null,
          rates: fxRecent.map(fxDto),
        },
      })
    );
  });
}
