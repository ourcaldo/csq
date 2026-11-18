-- Audit-log retention fix (security audit run-1, finding
-- admin-delete-cascades-audit-log): the accountability record must outlive
-- the actor. adminEmail snapshots the actor at write time and the FK becomes
-- SetNull (no more cascade delete of an operator's history).

-- Add the snapshot column (nullable first, backfill, then tighten).
ALTER TABLE "AdminActionLog" ADD COLUMN "adminEmail" TEXT;

-- Backfill from the existing rows' actors.
UPDATE "AdminActionLog" l
SET "adminEmail" = a."email"
FROM "AdminUser" a
WHERE a."id" = l."adminId";

ALTER TABLE "AdminActionLog" ALTER COLUMN "adminEmail" SET NOT NULL;

-- Make the actor reference nullable with SetNull behavior.
ALTER TABLE "AdminActionLog" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "AdminActionLog" DROP CONSTRAINT "AdminActionLog_adminId_fkey";
ALTER TABLE "AdminActionLog"
  ADD CONSTRAINT "AdminActionLog_adminId_fkey" FOREIGN KEY ("adminId")
  REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
