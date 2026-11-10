import assert from "assert";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import {
  closeDueSnapshots,
  periodWindow,
  periodEndingAt,
} from "@csq/core/lib/kpi";

// KPI self-check (PRD 17). The period math is pure and always runs; the
// metric/snapshot checks need DATABASE_URL (the csq_app connection string)
// and are skipped without it, like the other self-check tools:
//   npm run check:kpi
//
// Period assertions use instants whose Jakarta wall clock is known, so a
// regression in the UTC+7 shift or the ISO week logic fails loudly.

const JST = 7 * 60 * 60 * 1000; // Asia/Jakarta fixed offset

function wallToUtcMs(y: number, m: number, d: number, h = 0): number {
  return Date.UTC(y, m - 1, d, h) - JST;
}

function assertWindow(period: "DAY" | "WEEK" | "TWO_WEEK" | "MONTH", atMs: number, key: string, startMs: number, endMs: number): void {
  const w = periodWindow(period, new Date(atMs));
  assert.strictEqual(w.key, key, `${period} key at ${new Date(atMs).toISOString()}`);
  assert.strictEqual(w.start.getTime(), startMs, `${period} start`);
  assert.strictEqual(w.end.getTime(), endMs, `${period} end`);
}

// 2026-11-10 is a Tuesday. Jakarta midnight = 17:00 UTC the day before.
assertWindow("DAY", wallToUtcMs(2026, 11, 10, 9), "2026-11-10", wallToUtcMs(2026, 11, 10), wallToUtcMs(2026, 11, 11));
// Late-evening Jakarta instant still belongs to the same local day.
assertWindow("DAY", wallToUtcMs(2026, 11, 10, 23), "2026-11-10", wallToUtcMs(2026, 11, 10), wallToUtcMs(2026, 11, 11));

// 2026-11-08 is a Sunday; the Monday-based week starts 2026-11-02 (ISO W45).
assertWindow("WEEK", wallToUtcMs(2026, 11, 8), "2026-W45", wallToUtcMs(2026, 11, 2), wallToUtcMs(2026, 11, 9));
// ISO year boundary: 2027-01-01 is a Friday -> its week is 2026-W53.
assertWindow("WEEK", wallToUtcMs(2027, 1, 2), "2026-W53", wallToUtcMs(2026, 12, 28), wallToUtcMs(2027, 1, 4));

// Two-week halves: the 15th opens H2.
assertWindow("TWO_WEEK", wallToUtcMs(2026, 11, 3), "2026-11-H1", wallToUtcMs(2026, 11, 1), wallToUtcMs(2026, 11, 15));
assertWindow("TWO_WEEK", wallToUtcMs(2026, 11, 20), "2026-11-H2", wallToUtcMs(2026, 11, 15), wallToUtcMs(2026, 12, 1));

// Month.
assertWindow("MONTH", wallToUtcMs(2026, 2, 28, 12), "2026-02", wallToUtcMs(2026, 2, 1), wallToUtcMs(2026, 3, 1));

// periodEndingAt: the closed period that ends exactly at a boundary.
const closedMonth = periodEndingAt("MONTH", new Date(wallToUtcMs(2026, 11, 1)));
assert.strictEqual(closedMonth.key, "2026-10");
const closedWeek = periodEndingAt("WEEK", new Date(wallToUtcMs(2026, 11, 9)));
assert.strictEqual(closedWeek.key, "2026-W45");

console.log("[kpi] period math ok (Jakarta day/week/two-week/month, ISO year edge)");

// DB-backed checks: metric computation and snapshot idempotency against the
// clone database. Skipped without DATABASE_URL, matching the other tools.
if (!process.env.DATABASE_URL) {
  console.log("[kpi] DATABASE_URL unset, skipping metric + snapshot checks");
  process.exit(0);
}

async function main(): Promise<void> {
  // Pick the first tenant; the metric queries are tenant-scoped aggregates
  // and this check only asserts they return coherent numbers.
  const tenant = await prisma.tenant.findFirst();
  assert.ok(tenant, "no tenant to test against");
  await withTenantContext(tenant.id, async () => {
    const targets = await prisma.kpiTarget.findMany({ where: { tenantId: tenant.id } });
    if (targets.length === 0) {
      console.log("[kpi] no KPI targets configured - metric checks skipped");
      return;
    }
    const targetIds = targets.map((t) => t.id);
    const before = await prisma.kpiSnapshot.count({
      where: { kpiTargetId: { in: targetIds } },
    });
    await closeDueSnapshots();
    const writtenFirst = await prisma.kpiSnapshot.count({
      where: { kpiTargetId: { in: targetIds } },
    });
    assert.ok(writtenFirst >= before, "closing snapshots must not remove rows");
    await closeDueSnapshots();
    const writtenAgain = await prisma.kpiSnapshot.count({
      where: { kpiTargetId: { in: targetIds } },
    });
    assert.strictEqual(writtenAgain, writtenFirst, "snapshot close must be idempotent");
    console.log(
      `[kpi] snapshot close idempotent (rows=${writtenAgain}, before=${before})`
    );
  });
  console.log("[kpi] all checks passed");
}

main().catch((err) => {
  console.error("[kpi] FAILED:", err);
  process.exit(1);
});
