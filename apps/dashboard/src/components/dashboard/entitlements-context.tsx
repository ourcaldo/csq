import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { PlanFeature, TenantUsage } from "@csq/core/types/entitlements";

// One entitlements fetch per dashboard page, shared by the shell nav, the
// plan banner, and feature-aware components (the inbox pipeline surfaces).
export type EntitlementsView = {
  planName: string | null;
  aiCreditsPerMonth: number | null;
  mauLimit: number | null;
  staffLimit: number | null;
  channelLimit: number | null;
  features: PlanFeature[];
  usage: TenantUsage;
  billingOverdue?: boolean;
};

const EntitlementsContext = createContext<EntitlementsView | null>(null);

export function EntitlementsProvider({
  value,
  children,
}: {
  value: EntitlementsView | null;
  children: ReactNode;
}) {
  return (
    <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>
  );
}

export function useEntitlements(): EntitlementsView | null {
  return useContext(EntitlementsContext);
}

// While entitlements load (null) every feature is treated as available, so
// the nav does not flicker for legacy tenants.
export function hasFeature(
  entitlements: EntitlementsView | null,
  feature: PlanFeature
): boolean {
  return !entitlements || entitlements.features.includes(feature);
}
