import { z } from "zod";

// PRD 17 (staff KPI): shared shapes for the dashboard API boundary. The
// Prisma enums are the source of truth for metric/period/scope; these are
// the request/response contracts built on top of them.

export const kpiMetricSchema = z.enum([
  "ORDERS",
  "DEALS_WON",
  "FIRST_RESPONSE",
  "REPLIES",
]);
export type KpiMetricName = z.infer<typeof kpiMetricSchema>;

export const kpiPeriodSchema = z.enum(["DAY", "WEEK", "TWO_WEEK", "MONTH"]);
export type KpiPeriodName = z.infer<typeof kpiPeriodSchema>;

export const kpiScopeSchema = z.enum(["TENANT", "USER"]);
export type KpiScopeName = z.infer<typeof kpiScopeSchema>;

// Create: metric/period/scope are fixed for the KPI's lifetime - a change of
// meaning is a new KPI (the PATCH route only edits value/threshold/active).
export const kpiTargetCreateSchema = z
  .object({
    scope: kpiScopeSchema,
    // The staff member; required when scope = USER.
    userId: z.string().uuid().nullable().optional(),
    metric: kpiMetricSchema,
    period: kpiPeriodSchema,
    // FIRST_RESPONSE only: the "within X minutes" threshold.
    thresholdMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
    // Count target; percent (0-100) for FIRST_RESPONSE.
    targetValue: z.number().min(0),
  })
  .superRefine((data, ctx) => {
    if (data.scope === "USER" && !data.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "KPI staf memerlukan anggota tim (userId).",
      });
    }
    if (data.scope === "TENANT" && data.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "KPI tenant tidak boleh menunjuk anggota tim.",
      });
    }
    // PRD 17.1: per-staff order attribution would be fiction - the AI
    // creates orders only in AI-handled chats.
    if (data.scope === "USER" && data.metric === "ORDERS") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "KPI pesanan hanya tersedia untuk tenant, bukan per staf.",
      });
    }
    if (data.metric === "FIRST_RESPONSE" && !data.thresholdMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "KPI waktu respons memerlukan batas waktu (thresholdMinutes).",
      });
    }
    if (data.metric !== "FIRST_RESPONSE" && data.thresholdMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Batas waktu hanya berlaku untuk KPI waktu respons.",
      });
    }
    if (data.metric === "FIRST_RESPONSE" && data.targetValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target persentase maksimum 100.",
      });
    }
  });
export type KpiTargetCreateInput = z.infer<typeof kpiTargetCreateSchema>;

// Edit: value/threshold/active only - never scope/metric/period.
export const kpiTargetUpdateSchema = z.object({
  targetValue: z.number().min(0).optional(),
  thresholdMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  active: z.boolean().optional(),
});
export type KpiTargetUpdateInput = z.infer<typeof kpiTargetUpdateSchema>;

// One KPI row for the report: the target definition plus the live current
// period plus the closed-period history (newest first).
export type KpiReportRow = {
  id: string;
  scope: KpiScopeName;
  userId: string | null;
  userName: string | null;
  metric: KpiMetricName;
  period: KpiPeriodName;
  thresholdMinutes: number | null;
  targetValue: number;
  active: boolean;
  current: {
    key: string;
    start: string;
    end: string;
    actual: number;
    meta: Record<string, unknown> | null;
    progress: number; // 0-100 percent of target
    achieved: boolean;
  };
  history: Array<{
    key: string;
    start: string;
    end: string;
    actual: number;
    target: number;
    achieved: boolean;
  }>;
};
