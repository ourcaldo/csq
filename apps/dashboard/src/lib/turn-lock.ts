import { randomUUID } from "crypto";
import prisma from "@/lib/db";

// Per-conversation turn lease (D1). Replaces the old pattern of wrapping the
// whole agent turn - including LLM HTTP latency - in a Postgres transaction
// with pg_advisory_xact_lock. That transaction pinned one pooled connection
// per active turn for up to minutes, which starved the connection pool and
// died with "Transaction already closed" whenever the LLM was slow.
//
// The lease is two UPDATEs on the conversation row: no transaction, no held
// connection, and it works across instances. A lease older than
// STALE_LOCK_INTERVAL is from a crashed process and may be stolen, so a
// crashed turn can never silence a conversation permanently. The stale
// window must exceed the agent turn budget (TURN_BUDGET_MS in
// services/llm-runtime.ts, 90s) so a live turn is never stolen.

const STALE_LOCK_INTERVAL = "3 minutes";

// Returns the lease id when this caller owns the turn, null when another
// turn is in flight (the caller must simply return - the owner's drain loop
// will pick the new message up as an unanswered inbound).
export async function acquireTurnLease(
  conversationId: string,
  tenantId: string
): Promise<string | null> {
  const leaseId = randomUUID();
  const updated = await prisma.$executeRaw`
    UPDATE "Conversation"
    SET "turnLockId" = ${leaseId}, "turnLockedAt" = NOW()
    WHERE "id" = ${conversationId}
      AND "tenantId" = ${tenantId}
      AND ("turnLockedAt" IS NULL OR "turnLockedAt" < NOW() - ${STALE_LOCK_INTERVAL}::interval)
  `;
  return updated === 1 ? leaseId : null;
}

// Release only our own lease: the guard on turnLockId means a stale-turn
// recovery or a concurrent steal can never clear someone else's lock.
export async function releaseTurnLease(
  conversationId: string,
  tenantId: string,
  leaseId: string
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Conversation"
    SET "turnLockId" = NULL, "turnLockedAt" = NULL
    WHERE "id" = ${conversationId}
      AND "tenantId" = ${tenantId}
      AND "turnLockId" = ${leaseId}
  `;
}
