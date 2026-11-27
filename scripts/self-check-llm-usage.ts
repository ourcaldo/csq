import { Prisma } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { computeCostUsd, recordLlmUsage } from "@csq/core/lib/llm-usage";

// LLM usage + cost self-check (PRD 33). Assert-based, exits non-zero on any
// failure. Verifies the pure cost math (Decimal, 8-decimal rounding) and
// round-trips recordLlmUsage against the clone DB with a temp price row and a
// temp FX rate. Scratch rows are created and removed, so it is safe to re-run:
//   DATABASE_URL=<clone> npx tsx scripts/self-check-llm-usage.ts

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`[llm-usage] ok - ${label}`);
  } else {
    failures += 1;
    console.error(`[llm-usage] FAIL - ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const REF = "self-check-llm-usage";
const REF_UNPRICED = "self-check-llm-usage-unpriced";

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[llm-usage] DATABASE_URL is required");
    process.exit(1);
  }

  // Pure cost math (no DB): 1500 prompt * 1.00/1M + 500 completion * 2.00/1M.
  const cost = computeCostUsd({
    promptTokens: 1500,
    completionTokens: 500,
    inputUsdPer1M: new Prisma.Decimal("1.00"),
    outputUsdPer1M: new Prisma.Decimal("2.00"),
  });
  check(
    "computeCostUsd formula",
    cost.equals(new Prisma.Decimal("0.0025")),
    cost.toString()
  );

  // 8-decimal rounding: 1 token at 123.456789 USD/1M = 0.000123456789.
  const rounded = computeCostUsd({
    promptTokens: 1,
    inputUsdPer1M: new Prisma.Decimal("123.456789"),
    outputUsdPer1M: new Prisma.Decimal("0"),
  });
  check(
    "computeCostUsd rounds to 8 decimals",
    rounded.equals(new Prisma.Decimal("0.00012346")),
    rounded.toString()
  );

  await withSystemContext(async () => {
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    if (!tenant) {
      check("a tenant exists to charge", false);
      return;
    }

    // Temp price row: 1.00 USD/1M input, 2.00 USD/1M output.
    await prisma.llmModelPrice.create({
      data: {
        model: "self-check-model",
        inputUsdPer1M: new Prisma.Decimal("1.00"),
        outputUsdPer1M: new Prisma.Decimal("2.00"),
        updatedById: "self-check",
      },
    });
    // Temp FX rate for today (UTC day) unless one exists already.
    const today = utcDayStart(new Date());
    const existingFx = await prisma.fxRate.findUnique({
      where: { date: today },
    });
    const createdFx = !existingFx;
    const rate = existingFx?.usdIdr ?? new Prisma.Decimal("16000");
    if (!existingFx) {
      await prisma.fxRate.create({
        data: { date: today, usdIdr: rate, source: "AUTO" },
      });
    }

    await recordLlmUsage({
      tenantId: tenant.id,
      source: "SCENARIO_AI",
      refId: REF,
      model: "self-check-model",
      promptTokens: 1500,
      completionTokens: 500,
    });
    const row = await prisma.llmUsage.findFirst({
      where: { tenantId: tenant.id, refId: REF },
      orderBy: { createdAt: "desc" },
    });
    check("priced usage row written", !!row);
    check(
      "costUsd snapshot",
      row?.costUsd?.equals(new Prisma.Decimal("0.0025")) ?? false,
      row?.costUsd?.toString() ?? "missing"
    );
    check(
      "fx snapshot",
      row?.fxRateIdrPerUsd?.equals(rate) ?? false,
      row?.fxRateIdrPerUsd?.toString() ?? "missing"
    );
    check(
      "costIdr = costUsd * fx, 4 decimals",
      row?.costIdr?.equals(
        new Prisma.Decimal("0.0025").mul(rate).toDecimalPlaces(4)
      ) ?? false,
      row?.costIdr?.toString() ?? "missing"
    );

    // No price row for the model: tokens recorded, costs null.
    await recordLlmUsage({
      tenantId: tenant.id,
      source: "SCENARIO_AI",
      refId: REF_UNPRICED,
      model: "self-check-unpriced-model",
      promptTokens: 10,
    });
    const unpriced = await prisma.llmUsage.findFirst({
      where: { tenantId: tenant.id, refId: REF_UNPRICED },
      orderBy: { createdAt: "desc" },
    });
    check(
      "unpriced row: null costs, tokens kept",
      !!unpriced &&
        unpriced.costUsd === null &&
        unpriced.costIdr === null &&
        unpriced.promptTokens === 10,
      `costUsd ${unpriced?.costUsd ?? "row missing"}`
    );

    // Fail-soft: a FK violation (bogus tenant) must not throw into the caller.
    let threw = false;
    try {
      await recordLlmUsage({
        tenantId: "no-such-tenant",
        source: "AGENT_CALL",
        model: "self-check-model",
      });
    } catch {
      threw = true;
    }
    check("recordLlmUsage never throws on DB error", !threw);

    // Cleanup: only the rows this script created.
    await prisma.llmUsage.deleteMany({
      where: { tenantId: tenant.id, refId: { in: [REF, REF_UNPRICED] } },
    });
    await prisma.llmModelPrice.delete({
      where: { model: "self-check-model" },
    });
    if (createdFx) {
      await prisma.fxRate.delete({ where: { date: today } });
    }
    check("cleanup done", true);
  });

  if (failures > 0) {
    console.error(`[llm-usage] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("[llm-usage] all checks passed");
}

main()
  .catch((err: unknown) => {
    console.error("[llm-usage] check crashed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
