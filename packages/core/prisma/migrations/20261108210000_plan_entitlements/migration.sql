-- Plan repurpose (owner decision 2026-11-08): AI credits, MAU, staff and
-- channel seats, tenant allowance and feature flags replace the free-form
-- limits blob. NULL means unlimited for that dimension.

ALTER TABLE "Plan"
  ADD COLUMN "aiCreditsPerMonth" INTEGER,
  ADD COLUMN "mauLimit" INTEGER,
  ADD COLUMN "staffLimit" INTEGER,
  ADD COLUMN "channelLimit" INTEGER,
  ADD COLUMN "tenantLimit" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Preserve the two limits the old blob actually carried.
UPDATE "Plan" SET
  "aiCreditsPerMonth" = NULLIF("limits" ->> 'agentRepliesPerMonth', '')::INTEGER,
  "channelLimit" = NULLIF("limits" ->> 'channels', '')::INTEGER;

ALTER TABLE "Plan" DROP COLUMN "limits";
