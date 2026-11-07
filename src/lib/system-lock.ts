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

// Acquire-or-renew a lease WITHOUT withSystemLock's run-and-release
// semantics - for long-held ownership like the Baileys WhatsApp socket, where
// the holder must keep renewing for as long as its process lives. Non-force
// succeeds only when the lease is free, expired, or already held by this
// owner (renewal). force=true steals it - used when the owner explicitly
// re-connects a channel, to take over from a peer that is still draining
// after a deploy.
export async function acquireSystemLease(
  key: string,
  ownerToken: string,
  ttlSeconds: number,
  force = false
): Promise<boolean> {
  const acquired = await prisma.$executeRaw`
    INSERT INTO "SystemLock" ("key", "token", "lockedUntil", "updatedAt")
    VALUES (${key}, ${ownerToken}, NOW() + (${ttlSeconds}::text || ' seconds')::interval, NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "token" = EXCLUDED."token",
          "lockedUntil" = EXCLUDED."lockedUntil",
          "updatedAt" = NOW()
      WHERE ${force} OR "SystemLock"."token" = ${ownerToken} OR "SystemLock"."lockedUntil" < NOW()
  `;
  return acquired === 1;
}

// Release a lease this owner still holds (a stale token never deletes a
// lease another owner has re-acquired).
export async function releaseSystemLease(
  key: string,
  ownerToken: string
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "SystemLock"
    WHERE "key" = ${key} AND "token" = ${ownerToken}
  `;
}
