import { Prisma } from "@prisma/client";
import type { LlmUsageSource } from "@prisma/client";
import prisma from "@csq/core/lib/db";

// LLM usage and cost tracking (PRD 33). recordLlmUsage is the single write
// point every LLM call site shares: it snapshots the operator's current price
// row and the day's USD/IDR rate onto one LlmUsage row, so later price or FX
// edits never rewrite recorded history. Fail-soft ALWAYS: a usage write is
// telemetry, never billing truth, and must never throw into a customer turn.

export type RecordLlmUsageInput = {
  tenantId: string;
  source: LlmUsageSource;
  // The turn ref (trigger Message id) or ScenarioRunStep id - the same ref
  // the credit ledger uses where one exists.
  refId?: string;
  conversationId?: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
};

// costUsd = promptTokens * inputUsdPer1M/1e6 + completionTokens *
// outputUsdPer1M/1e6, rounded to 8 decimals. Prisma.Decimal only - never
// floats for money. Exported pure so the self-check can assert the math.
export function computeCostUsd(input: {
  promptTokens?: number;
  completionTokens?: number;
  inputUsdPer1M: Prisma.Decimal;
  outputUsdPer1M: Prisma.Decimal;
}): Prisma.Decimal {
  const prompt = new Prisma.Decimal(input.promptTokens ?? 0);
  const completion = new Prisma.Decimal(input.completionTokens ?? 0);
  return prompt
    .mul(input.inputUsdPer1M)
    .add(completion.mul(input.outputUsdPer1M))
    .div(1_000_000)
    .toDecimalPlaces(8);
}

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export async function recordLlmUsage(input: RecordLlmUsageInput): Promise<void> {
  try {
    const price = await prisma.llmModelPrice.findUnique({
      where: { model: input.model },
    });
    // FX rule (PRD 33): today's UTC-day rate; fail-soft reuse of the most
    // recent row when today's fetch has not landed yet; null when none exist.
    const today = utcDayStart(new Date());
    const fx =
      (await prisma.fxRate.findUnique({ where: { date: today } })) ??
      (await prisma.fxRate.findFirst({ orderBy: { date: "desc" } }));

    const costUsd = price
      ? computeCostUsd({
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
          inputUsdPer1M: price.inputUsdPer1M,
          outputUsdPer1M: price.outputUsdPer1M,
        })
      : null;
    const fxRateIdrPerUsd = fx?.usdIdr ?? null;
    const costIdr =
      costUsd && fxRateIdrPerUsd
        ? costUsd.mul(fxRateIdrPerUsd).toDecimalPlaces(4)
        : null;

    await prisma.llmUsage.create({
      data: {
        tenantId: input.tenantId,
        source: input.source,
        refId: input.refId ?? null,
        conversationId: input.conversationId ?? null,
        model: input.model,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        costUsd,
        fxRateIdrPerUsd,
        costIdr,
      },
    });
  } catch (err) {
    // Never throw into a customer turn (PRD 33: a lost row is acceptable
    // telemetry loss).
    console.warn(
      `[llm-usage] failed to record ${input.source} row for model ${input.model}:`,
      err instanceof Error ? err.message : err
    );
  }
}
