-- Audit run-3 fixes (2026-11-22):
-- admin.tenant-owner-takeover: User.passwordChangedAt is the session-revocation
-- stamp - embedded in the JWT at sign-in and re-checked on every request so a
-- password reset kills all outstanding stateless sessions immediately.
-- audit.actor-misattribution: AuditLog.actorEmail snapshots the acting human
-- (same pattern as AdminActionLog.adminEmail) so the audit page never falls
-- back to attributing actions to the viewing owner.

ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "AuditLog" ADD COLUMN "actorEmail" TEXT;
