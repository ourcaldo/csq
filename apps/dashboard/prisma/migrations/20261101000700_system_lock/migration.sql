-- D10d: cross-instance cron mutual exclusion. startScheduler() boots from the
-- health endpoint on every instance, so a second instance would duplicate
-- Sheets syncs, scenario runs, and session-close messages. A lock row with a
-- TTL is a lease: a crashed tick self-heals when its TTL expires. The token
-- column is the owner id, so a tick can never release a lease another tick
-- has already re-acquired after an expiry.

-- CreateTable
CREATE TABLE "SystemLock" (
    "key" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemLock_pkey" PRIMARY KEY ("key")
);
