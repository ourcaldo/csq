import { z } from "zod";

// Campaign shared types + Zod schemas (feature plan 2026-11-01, sections
// 3.4/3.6). The engine and the API routes both validate through this module.

export type ScheduleKind =
  | "ONCE"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "INTERVAL";

// Per-kind config, all times in the platform schedule timezone
// (SCENARIO_SCHEDULE_TZ, default Asia/Jakarta):
// - ONCE:     { startAt: ISO datetime }
// - DAILY:    { time: "HH:MM" }
// - WEEKLY:   { time: "HH:MM", dayOfWeek: 0-6 }   (0 = Sunday)
// - MONTHLY:  { time: "HH:MM", dayOfMonth: 1-31 } (clamped to month length)
// - INTERVAL: { time: "HH:MM", everyDays: N }     (first fire = next
//             occurrence of `time`; later fires = lastRunAt + N days)
export const scheduleConfigSchema = z
  .object({
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format waktu HH:MM, mis. 09:00")
      .optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    everyDays: z.number().int().min(1).max(365).optional(),
    startAt: z.string().datetime().optional(),
  })
  .passthrough();

export const campaignCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    channelId: z.string().uuid(),
    audience: z.enum(["ALL", "CATEGORY", "TAGS", "MANUAL"]),
    categoryIds: z.array(z.string().uuid()).max(20).default([]),
    tagIds: z.array(z.string().uuid()).max(20).default([]),
    contactIds: z.array(z.string().uuid()).max(2000).default([]),
    // Content: either a fresh body, or an internal template key whose content
    // is snapshotted at save time (BODY or META kind), or both (a META template
    // still needs a body — it is the Baileys text and the preview).
    templateKey: z.string().max(60).optional(),
    body: z.string().max(1024).optional(),
    imageIds: z.array(z.string().uuid()).max(4).default([]),
    scheduleKind: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY", "INTERVAL"]),
    scheduleConfig: scheduleConfigSchema.default({}),
    delaySeconds: z.number().int().min(10).max(3600).default(30),
  })
  .superRefine((data, ctx) => {
    if (data.audience === "CATEGORY" && data.categoryIds.length === 0) {
      ctx.addIssue({ code: "custom", message: "Pilih minimal satu kategori.", path: ["categoryIds"] });
    }
    if (data.audience === "TAGS" && data.tagIds.length === 0) {
      ctx.addIssue({ code: "custom", message: "Pilih minimal satu tag.", path: ["tagIds"] });
    }
    if (data.audience === "MANUAL" && data.contactIds.length === 0) {
      ctx.addIssue({ code: "custom", message: "Pilih minimal satu kontak.", path: ["contactIds"] });
    }
    if (data.scheduleKind === "ONCE" && !data.scheduleConfig.startAt) {
      ctx.addIssue({ code: "custom", message: "Tentukan tanggal & jam untuk kampanye sekali jalan.", path: ["scheduleConfig"] });
    }
    if (data.scheduleKind !== "ONCE" && !data.scheduleConfig.time) {
      ctx.addIssue({ code: "custom", message: "Tentukan jam (HH:MM) untuk jadwal berulang.", path: ["scheduleConfig"] });
    }
    if (data.scheduleKind === "WEEKLY" && data.scheduleConfig.dayOfWeek === undefined) {
      ctx.addIssue({ code: "custom", message: "Pilih hari untuk jadwal mingguan.", path: ["scheduleConfig"] });
    }
    if (data.scheduleKind === "MONTHLY" && data.scheduleConfig.dayOfMonth === undefined) {
      ctx.addIssue({ code: "custom", message: "Pilih tanggal untuk jadwal bulanan.", path: ["scheduleConfig"] });
    }
    if (data.scheduleKind === "INTERVAL" && data.scheduleConfig.everyDays === undefined) {
      ctx.addIssue({ code: "custom", message: "Tentukan jumlah hari untuk jadwal berinterval.", path: ["scheduleConfig"] });
    }
  });
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

// Campaign update is the same shape, applied only while DRAFT or PAUSED.
export const campaignUpdateSchema = campaignCreateSchema;
export type CampaignUpdateInput = CampaignCreateInput;

// Audience preview input (the wizard's live count).
export const campaignPreviewSchema = z.object({
  audience: z.enum(["ALL", "CATEGORY", "TAGS", "MANUAL"]),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  contactIds: z.array(z.string().uuid()).max(2000).default([]),
});
export type CampaignPreviewInput = z.infer<typeof campaignPreviewSchema>;

// ── Client-side serialized shapes (dashboard UI) ──

export type CampaignMessageRow = {
  id: string;
  phone: string;
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  scheduledFor: string;
  sentAt: string | null;
  reason: string | null;
};

export type CampaignRunRow = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  counts: { total?: number; sent?: number; failed?: number; skipped?: number } | null;
  messages?: CampaignMessageRow[];
};

export type CampaignRow = {
  id: string;
  channelId: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
  audience: "ALL" | "CATEGORY" | "TAGS" | "MANUAL";
  categoryIds: string[];
  tagIds: string[];
  contactIds: string[];
  sendKind: "BODY" | "META_TEMPLATE";
  body: string;
  imageIds: string[];
  metaName: string | null;
  metaLanguage: string | null;
  scheduleKind: ScheduleKind;
  scheduleConfig: z.infer<typeof scheduleConfigSchema>;
  delaySeconds: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
};
