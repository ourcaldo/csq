// Plan feature catalog (PRD 13, owner decision 2026-11-08). Keys are stored
// on Plan.features; labels are shared by the admin console and the tenant
// dashboard. Adding a feature here does NOT enforce it by itself - the nav,
// page guard, and API/worker gate for that feature must also exist.
export const PLAN_FEATURE_KEYS = ["campaigns", "scenarios", "pipeline"] as const;

export type PlanFeature = (typeof PLAN_FEATURE_KEYS)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  campaigns: "Kampanye",
  scenarios: "Skenario",
  pipeline: "Pipeline",
};

export function isPlanFeature(value: string): value is PlanFeature {
  return PLAN_FEATURE_KEYS.some((key) => key === value);
}

export type TenantEntitlements = {
  planName: string | null;
  aiCreditsPerMonth: number | null;
  mauLimit: number | null;
  staffLimit: number | null;
  channelLimit: number | null;
  tenantLimit: number | null;
  features: PlanFeature[];
};

// Monthly usage for one tenant. AI credits = automatic agent replies (1 each)
// + executed scenario modules excluding trigger and end (1 each).
export type TenantUsage = {
  mau: number;
  agentReplies: number;
  scenarioCredits: number;
  creditsUsed: number;
  staff: number;
  channels: number;
};
