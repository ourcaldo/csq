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
// Amendment 2026-11-10 (owner review): FIRST_RESPONSE is measurement-only -
// threshold minutes (SLA), no percentage target; and ALL_STAFF creates one
// KPI per team member in one action.
export const kpiTargetCreateSchema = z
  .object({
    scope: kpiScopeSchema,
    // The staff member; required when scope = USER and allStaff is false.
    userId: z.string().uuid().nullable().optional(),
    // scope = USER + allStaff = true: one KPI per current team member.
    allStaff: z.boolean().optional(),
    metric: kpiMetricSchema,
    period: kpiPeriodSchema,
    // FIRST_RESPONSE only: the "respond within X minutes" SLA.
    thresholdMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
    // Count target. FIRST_RESPONSE is measurement-only: 0 (no target).
    targetValue: z.number().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scope === "USER" && !data.allStaff && !data.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "KPI staf memerlukan anggota tim (userId).",
      });
    }
    if (data.scope === "TENANT" && (data.userId || data.allStaff)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "KPI tenant tidak boleh menunjuk anggota tim.",
      });
    }
    if (data.scope === "USER" && data.allStaff && data.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pilih salah satu: anggota tim tertentu atau semua anggota.",
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
    if (data.metric === "FIRST_RESPONSE") {
      // Measurement-only: SLA threshold in, percentage target out.
      if (!data.thresholdMinutes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "KPI waktu respons memerlukan batas waktu (thresholdMinutes).",
        });
      }
      if (data.targetValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "KPI waktu respons tidak memakai target persentase - sistem menghitung otomatis.",
        });
      }
    } else {
      if (data.thresholdMinutes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Batas waktu hanya berlaku untuk KPI waktu respons.",
        });
      }
      if (!data.targetValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "KPI jumlah memerlukan target angka.",
        });
      }
    }
  });
export type KpiTargetCreateInput = z.infer<typeof kpiTargetCreateSchema>;

// Edit: value/threshold/active only - never scope/metric/period. For
// FIRST_RESPONSE (measurement-only) the numeric target is not editable -
// only the SLA threshold and active state are.
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
