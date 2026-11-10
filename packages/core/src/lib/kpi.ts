import { Prisma } from "@prisma/client";
import type { KpiMetric, KpiPeriod, KpiTarget } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import {
  tenantRaw,
  withSystemContext,
  withTenantContext,
} from "@csq/core/lib/tenant-context";

// PRD 17 (staff KPI): period math, metric computation, and the snapshot
// closer. Shared by the dashboard report API (current period, computed live)
// and the worker scheduler (closed periods, snapshotted once).
//
// All periods are Asia/Jakarta calendar windows (PRD 17.3). Jakarta is a
// fixed UTC+7 with no DST since 1963, so wall-clock math is a constant
// shift - no timezone database or date library is needed.

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PeriodWindow = {
  // Sortable per-period key: day 2026-11-10, week 2026-W45, two-week
  // 2026-11-H1/H2, month 2026-11.
  key: string;
  start: Date;
  end: Date;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Wall-clock (Jakarta) view of an instant: reading the getUTC* fields of
// this shifted Date yields the Jakarta wall clock.
function jakartaWall(at: Date): Date {
  return new Date(at.getTime() + JAKARTA_OFFSET_MS);
}

function wallToUtc(wallMs: number): Date {
  return new Date(wallMs - JAKARTA_OFFSET_MS);
}

// ISO week key ("2026-W45") of the week whose Monday wall-clock ms is given.
// The ISO year is decided by that week's Thursday, so early-January and
// late-December weeks are labeled correctly.
function isoWeekKey(mondayWallMs: number): string {
  const thursday = new Date(mondayWallMs + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const jan4WallMs = Date.UTC(isoYear, 0, 4);
  const jan4Weekday = (new Date(jan4WallMs).getUTCDay() + 6) % 7; // Mon=0
  const week1Monday = jan4WallMs - jan4Weekday * DAY_MS;
  const week = Math.floor((mondayWallMs - week1Monday) / (7 * DAY_MS)) + 1;
  return `${isoYear}-W${pad2(week)}`;
}

// The calendar window of `period` containing the instant `at`.
export function periodWindow(period: KpiPeriod, at: Date): PeriodWindow {
  const wall = jakartaWall(at);
  const y = wall.getUTCFullYear();
  const m = wall.getUTCMonth(); // 0-based
  const d = wall.getUTCDate();

  if (period === "DAY") {
    const startWall = Date.UTC(y, m, d);
    return {
      key: `${y}-${pad2(m + 1)}-${pad2(d)}`,
      start: wallToUtc(startWall),
      end: wallToUtc(startWall + DAY_MS),
    };
  }

  if (period === "WEEK") {
    const weekday = (wall.getUTCDay() + 6) % 7; // Mon=0
    const startWall = Date.UTC(y, m, d - weekday);
    return {
      key: isoWeekKey(startWall),
      start: wallToUtc(startWall),
      end: wallToUtc(startWall + 7 * DAY_MS),
    };
  }

  if (period === "TWO_WEEK") {
    const half = d <= 14 ? 1 : 2;
    const startWall = Date.UTC(y, m, half === 1 ? 1 : 15);
    const endWall = half === 1 ? Date.UTC(y, m, 15) : Date.UTC(y, m + 1, 1);
    return {
      key: `${y}-${pad2(m + 1)}-H${half}`,
      start: wallToUtc(startWall),
      end: wallToUtc(endWall),
    };
  }

  // MONTH
  return {
    key: `${y}-${pad2(m + 1)}`,
    start: wallToUtc(Date.UTC(y, m, 1)),
    end: wallToUtc(Date.UTC(y, m + 1, 1)),
  };
}

// The closed period of this kind that ends exactly at `endExclusive`.
// Snapshot backfill walks backwards using the current period's start.
export function periodEndingAt(
  period: KpiPeriod,
  endExclusive: Date
): PeriodWindow {
  return periodWindow(period, new Date(endExclusive.getTime() - 1));
}

export type KpiMeasureInput = {
  tenantId: string;
  scope: "TENANT" | "USER";
  userId: string | null;
  metric: KpiMetric;
  thresholdMinutes: number | null;
};

export type KpiActual = {
  value: number;
  meta: Record<string, unknown> | null;
};

// Compute a metric over [from, to). MUST run inside the tenant's RLS context
// (the report route already wraps in withTenantContext; the snapshot closer
// wraps per target). Returns the value plus the context needed to interpret
// it later (FIRST_RESPONSE: threshold and measured counts).
export async function computeActual(
  input: KpiMeasureInput,
  from: Date,
  to: Date
): Promise<KpiActual> {
  const inWindow = { gte: from, lt: to };

  if (input.metric === "ORDERS") {
    const value = await prisma.order.count({
      where: { tenantId: input.tenantId, createdAt: inWindow },
    });
    return { value, meta: null };
  }

  if (input.metric === "REPLIES") {
    // Amendment 2026-11-10: unique conversations replied in, not raw
    // messages - "balas 50 chat" means 50 chats, not 50 bubbles in one chat.
    const rows = await prisma.message.findMany({
      where: {
        tenantId: input.tenantId,
        direction: "OUTBOUND",
        senderType: "HUMAN",
        isInternal: false,
        createdAt: inWindow,
        ...(input.scope === "USER" && input.userId
          ? { senderUserId: input.userId }
          : {}),
      },
      select: { conversationId: true },
      distinct: ["conversationId"],
    });
    return { value: rows.length, meta: null };
  }

  if (input.metric === "DEALS_WON") {
    // The history row stores the stage moved INTO (toStageId); WON-ness lives
    // on the Stage row. Two queries instead of a schema relation.
    const wonStages = await prisma.stage.findMany({
      where: { tenantId: input.tenantId, kind: "WON" },
      select: { id: true },
    });
    if (wonStages.length === 0) return { value: 0, meta: null };
    const value = await prisma.dealStageHistory.count({
      where: {
        tenantId: input.tenantId,
        createdAt: inWindow,
        toStageId: { in: wonStages.map((s) => s.id) },
        ...(input.scope === "USER" && input.userId
          ? { movedByUserId: input.userId }
          : {}),
      },
    });
    return { value, meta: null };
  }

  // FIRST_RESPONSE (amended 2026-11-10, owner review): measurement-only.
  // Incoming chats = conversations that received a customer message in the
  // window. Answered = at least one human reply in the window whose latency
  // to the newest customer message before it is within the SLA. Value =
  // derived share (no configured percentage), meta carries the average
  // latency and the raw chat counts.
  const slaSeconds = (input.thresholdMinutes ?? 0) * 60;
  const userFilter =
    input.scope === "USER" && input.userId
      ? Prisma.sql` AND r."senderUserId" = ${input.userId}`
      : Prisma.empty;
  const rows = await tenantRaw(
    input.tenantId,
    prisma.$queryRaw<
      Array<{ incoming: number; answered: number; avgSeconds: number | null }>
    >`
      WITH incoming AS (
        SELECT DISTINCT m."conversationId" AS cid
        FROM "Message" m
        WHERE m."tenantId" = ${input.tenantId}
          AND m."direction" = 'INBOUND'
          AND m."isInternal" = false
          AND m."createdAt" >= ${from}
          AND m."createdAt" < ${to}
      ),
      latencies AS (
        SELECT r."conversationId" AS cid,
               EXTRACT(EPOCH FROM (r."createdAt" - sub.inbound_at)) AS secs
        FROM "Message" r
        JOIN (
          SELECT m2."conversationId", m2."id", m2."createdAt",
                 (SELECT MAX(mi."createdAt") FROM "Message" mi
                  WHERE mi."conversationId" = m2."conversationId"
                    AND mi."direction" = 'INBOUND'
                    AND mi."isInternal" = false
                    AND mi."createdAt" < m2."createdAt") AS inbound_at
          FROM "Message" m2
          WHERE m2."tenantId" = ${input.tenantId}
            AND m2."direction" = 'OUTBOUND'
            AND m2."senderType" = 'HUMAN'
            AND m2."isInternal" = false
            AND m2."createdAt" >= ${from}
            AND m2."createdAt" < ${to}
        ) sub ON sub.id = r.id
        WHERE sub.inbound_at IS NOT NULL${userFilter}
      )
      SELECT
        (SELECT COUNT(*) FROM incoming)::int AS "incoming",
        (SELECT COUNT(DISTINCT l.cid) FROM latencies l
          WHERE l.secs <= ${slaSeconds})::int AS "answered",
        (SELECT AVG(l.secs) FROM latencies l) AS "avgSeconds"
    `
  );
  const incoming = rows[0]?.incoming ?? 0;
  const answered = rows[0]?.answered ?? 0;
  const value = incoming > 0 ? (answered / incoming) * 100 : 0;
  return {
    value,
    meta: {
      thresholdMinutes: input.thresholdMinutes,
      incomingChats: incoming,
      answeredChats: answered,
      avgMinutes:
        rows[0]?.avgSeconds !== null && rows[0]?.avgSeconds !== undefined
          ? Math.round((rows[0].avgSeconds / 60) * 10) / 10
          : null,
    },
  };
}

// PRD 17: the snapshot closer backfills at most this many periods on a
// target's first run; after that each run writes only newly closed periods.
const BACKFILL_PERIODS = 12;

// Close every due period for every active KPI target of every tenant
// (worker-side; crosses tenants, so system context picks the targets and
// each target's computation runs in its own tenant context). Idempotent:
// existing snapshots are never recomputed or rewritten.
export async function closeDueSnapshots(): Promise<{
  tenants: number;
  written: number;
}> {
  const targets = await withSystemContext(() =>
    prisma.kpiTarget.findMany({ where: { active: true } })
  );
  const tenants = new Set(targets.map((t) => t.tenantId));
  let written = 0;

  for (const target of targets) {
    await withTenantContext(target.tenantId, async () => {
      const existing = new Set(
        (
          await prisma.kpiSnapshot.findMany({
            where: { kpiTargetId: target.id },
            select: { periodKey: true },
          })
        ).map((s) => s.periodKey)
      );

      // Periods strictly before the current one are closed. Walk backwards
      // from the current period's start until an existing snapshot is hit
      // (history is backfilled contiguously) or the cap is reached.
      let cursor = periodWindow(target.period, new Date()).start;
      for (let i = 0; i < BACKFILL_PERIODS; i++) {
        const window = periodEndingAt(target.period, cursor);
        if (existing.has(window.key)) break;

        const { value, meta } = await computeActual(
          {
            tenantId: target.tenantId,
            scope: target.scope,
            userId: target.userId,
            metric: target.metric,
            thresholdMinutes: target.thresholdMinutes,
          },
          window.start,
          window.end
        );

        await prisma.kpiSnapshot.upsert({
          where: {
            kpiTargetId_periodKey: {
              kpiTargetId: target.id,
              periodKey: window.key,
            },
          },
          create: {
            tenantId: target.tenantId,
            kpiTargetId: target.id,
            periodKey: window.key,
            periodStart: window.start,
            periodEnd: window.end,
            actualValue: value,
            // Denormalized: later target edits never rewrite history.
            targetValue: target.targetValue,
            achieved: value >= target.targetValue,
            meta: meta ?? Prisma.DbNull,
          },
          // History is write-once; the existing-key check above makes this
          // path a no-op outside a concurrent double-close.
          update: {},
        });

        written += 1;
        cursor = window.start;
      }
    });
  }

  return { tenants: tenants.size, written };
}

// Convenience for the report route: the live value for a target's current
// period. Call inside the tenant context.
export async function computeCurrentPeriod(
  target: KpiTarget
): Promise<PeriodWindow & { actual: KpiActual; targetValue: number }> {
  const window = periodWindow(target.period, new Date());
  const actual = await computeActual(
    {
      tenantId: target.tenantId,
      scope: target.scope,
      userId: target.userId,
      metric: target.metric,
      thresholdMinutes: target.thresholdMinutes,
    },
    window.start,
    window.end
  );
  return { ...window, actual, targetValue: target.targetValue };
}
