import type { Prisma } from "@prisma/client";
import type { InventorySource } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/db";

// G8: source-priority resolution (PRD §13). The tenant's `sourcePriority`
// (an ordered array of source names on Tenant.settings) decides which source's
// stock quantity wins when multiple sources disagree for the same product. This
// module is the single source of truth for reading/interpreting that setting;
// the dashboard route imports from here.

const DEFAULT_PRIORITY: readonly string[] = ["MANUAL", "EXCEL", "GOOGLE_SHEETS"];
const VALID_PRIORITY: readonly string[] = ["MANUAL", "EXCEL", "GOOGLE_SHEETS"];

// Permissive read shape for stored settings (any strings allowed, then filtered).
// Resilient to legacy stored values outside the valid set (e.g. an old
// "MEMORY" entry) — invalid entries are dropped instead of throwing.
const storedSettingsSchema = z
  .object({ sourcePriority: z.array(z.string()).optional() })
  .passthrough();

// Read stored source priority defensively: drop entries outside the valid set,
// fall back to the default when empty. Pure function over the settings JSON.
export function readSourcePriority(settings: unknown): string[] {
  const parsed = storedSettingsSchema.safeParse(settings ?? {});
  const raw = parsed.success ? parsed.data.sourcePriority ?? [] : [];
  const filtered = raw.filter((v): v is string => VALID_PRIORITY.includes(v));
  return filtered.length ? filtered : [...DEFAULT_PRIORITY];
}

// Pick the snapshot whose source ranks highest in the tenant's priority order.
// Returns null when there are no snapshots. Pure.
export function resolveInventoryBySnapshots(
  snapshots: { source: InventorySource; quantity: number; sourceRef: string | null }[],
  priority: string[]
): { quantity: number; source: InventorySource; sourceRef: string | null } | null {
  if (snapshots.length === 0) return null;
  let best: { source: InventorySource; quantity: number; sourceRef: string | null } | null = null;
  let bestRank = Infinity;
  for (const s of snapshots) {
    const rank = priority.indexOf(s.source);
    // Unknown sources rank last (still preferred over nothing).
    const r = rank === -1 ? priority.length : rank;
    if (r < bestRank) {
      bestRank = r;
      best = s;
    }
  }
  return best;
}

// Resolve the authoritative stock for a (tenant, product) from per-source
// snapshots, falling back to the canonical Inventory row when no snapshots
// exist (e.g. legacy products seeded before snapshots). Uses `tx` when
// provided so callers inside a transaction share the same connection.
export async function resolveInventory(
  tenantId: string,
  productId: string,
  tx?: Prisma.TransactionClient
): Promise<{ quantity: number; source: InventorySource; sourceRef: string | null } | null> {
  const client = tx ?? prisma;
  const tenant = await client.tenant.findUnique({ where: { id: tenantId } });
  const priority = tenant ? readSourcePriority(tenant.settings) : [...DEFAULT_PRIORITY];

  const snapshots = await client.inventorySnapshot.findMany({
    where: { tenantId, productId },
    orderBy: { updatedAt: "desc" },
  });
  const resolved = resolveInventoryBySnapshots(snapshots, priority);
  if (resolved) return resolved;

  // Fall back to the canonical Inventory row.
  const inv = await client.inventory.findFirst({ where: { tenantId, productId } });
  return inv
    ? { quantity: inv.quantity, source: inv.source, sourceRef: inv.sourceRef }
    : null;
}
