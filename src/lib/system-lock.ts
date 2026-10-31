import { randomUUID } from "crypto";
import prisma from "@/lib/db";

// Cross-instance cron mutual exclusion (D10d). startScheduler() boots from
// the health endpoint on EVERY instance, so a second instance would duplicate
// Sheets syncs, scenario runs, and session-close messages.
//
// The lock is a lease with a TTL, not a mutex held forever: a tick that
// crashes without releasing self-heals as soon as its TTL expires, so a
// second instance can take over. The token is the owner id - a late tick can
// never release a lease another tick has already re-acquired after an expiry.
//
// Usage:
//   const result = await withSystemLock("sheets-sync", 240, syncAll);
//   // result === null -> another instance is running this tick; skip.
//
// The TTL must be LONGER than the tick it guards (so a slow tick is not
// overtaken mid-run) but short enough that a crash costs at most one TTL of
// missed ticks.

export async function withSystemLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const token = randomUUID();
  const acquired = await prisma.$executeRaw`
    INSERT INTO "SystemLock" ("key", "token", "lockedUntil", "updatedAt")
    VALUES (${key}, ${token}, NOW() + (${ttlSeconds}::text || ' seconds')::interval, NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "token" = EXCLUDED."token",
          "lockedUntil" = EXCLUDED."lockedUntil",
          "updatedAt" = NOW()
      WHERE "SystemLock"."lockedUntil" < NOW()
  `;
  if (acquired !== 1) return null;
  try {
    return await fn();
  } finally {
    await prisma.$executeRaw`
      DELETE FROM "SystemLock"
      WHERE "key" = ${key} AND "token" = ${token}
    `;
  }
}
