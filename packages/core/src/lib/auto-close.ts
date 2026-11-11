import { z } from "zod";
import prisma from "@csq/core/lib/db";

// Auto session close (owner decision 2026-11-11, PRD 03 amendment): a
// per-tenant, OWNER-configured setting in Tenant.settings.autoClose. When
// enabled, the worker closes an OPEN, AI-owned conversation whose LAST
// message is the agent's reply and whose customer has been silent for
// idleMinutes: it sends the session_end goodbye, marks the session closed,
// and sets the conversation RESOLVED. An unanswered customer message never
// auto-closes. Default: disabled (behavior changes only when a tenant opts
// in). This module is the single source of truth for the stored shape.

export const autoCloseSchema = z.object({
  enabled: z.boolean(),
  idleMinutes: z.number().int().min(15).max(24 * 60),
});
export type AutoCloseConfig = z.infer<typeof autoCloseSchema>;

export const AUTO_CLOSE_DEFAULTS: AutoCloseConfig = {
  enabled: false,
  idleMinutes: 60,
};

// Permissive read shape for the whole settings blob - preserves unrelated
// keys (sourcePriority, emailProvider, session-close stamps, ...) on write.
const storedSettingsSchema = z.object({}).passthrough();

export function parseAutoCloseConfig(settings: unknown): AutoCloseConfig {
  const parsed = storedSettingsSchema.safeParse(settings ?? {});
  if (!parsed.success) return AUTO_CLOSE_DEFAULTS;
  const cfg = autoCloseSchema.safeParse(parsed.data["autoClose"]);
  return cfg.success ? cfg.data : AUTO_CLOSE_DEFAULTS;
}

export async function getAutoCloseConfig(
  tenantId: string
): Promise<AutoCloseConfig> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) return AUTO_CLOSE_DEFAULTS;
  return parseAutoCloseConfig(tenant.settings);
}

export async function saveAutoCloseConfig(
  tenantId: string,
  config: AutoCloseConfig
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const existing = storedSettingsSchema.safeParse(tenant?.settings ?? {});
  const base = existing.success ? existing.data : {};
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...base, autoClose: config } },
  });
}
