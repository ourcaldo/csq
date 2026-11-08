import type { NextApiResponse } from "next";
import type { Session } from "next-auth";
import { apiError } from "@csq/core/types/api";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";
import { PLAN_FEATURE_LABELS, type PlanFeature } from "@csq/core/types/entitlements";

// API gate for a premium feature (PRD 14). Call right after the session check:
//   if (!(await requireFeatureApi(session, res, "campaigns"))) return;
// Returns true when allowed, otherwise sends 403 FEATURE_DISABLED.
export async function requireFeatureApi(
  session: Session,
  res: NextApiResponse,
  feature: PlanFeature
): Promise<boolean> {
  const entitlements = await getTenantEntitlements(session.user.tenantId);
  if (entitlements.features.includes(feature)) return true;

  res
    .status(403)
    .json(
      apiError(
        "FEATURE_DISABLED",
        `Fitur ${PLAN_FEATURE_LABELS[feature]} tidak aktif di paket ${
          entitlements.planName ?? "tenant"
        }.`
      )
    );
  return false;
}
