-- PRD 29: tenant custom roles, channel access grants, thread-per-channel
-- identity, and one-pipeline-card-per-customer.
-- Data steps run BEFORE the column drops so nothing is lost.

-- 1. New tables: Role + ChannelAccess.
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelAccess" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "principal" TEXT NOT NULL DEFAULT 'ROLE',
    "principalId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canCompose" BOOLEAN NOT NULL DEFAULT true,
    "canManage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelAccess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Role_tenantId_idx" ON "Role"("tenantId");
CREATE UNIQUE INDEX "Role_tenantId_name_key" ON "Role"("tenantId", "name");
CREATE INDEX "ChannelAccess_tenantId_idx" ON "ChannelAccess"("tenantId");
CREATE UNIQUE INDEX "ChannelAccess_channelId_principal_principalId_key" ON "ChannelAccess"("channelId", "principal", "principalId");

ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelAccess" ADD CONSTRAINT "ChannelAccess_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. New columns (drops happen in step 7, after the data moves).
ALTER TABLE "User" ADD COLUMN "isOwner" BOOLEAN NOT NULL DEFAULT false,
                     ADD COLUMN "roleId" TEXT;
ALTER TABLE "TeamInvite" ADD COLUMN "roleId" TEXT;
ALTER TABLE "Deal" ADD COLUMN "contactId" TEXT;

-- 3. OWNER flag from the old enum.
UPDATE "User" SET "isOwner" = true WHERE "role" = 'OWNER';

-- 4. Seed the system roles per tenant (PRD 29 section 4, owner decisions
-- 2026-11-23: Akses Penuh = everything except owner-only; Admin Chat =
-- full powers on the conversation surfaces, not read-only).
INSERT INTO "Role" ("id", "tenantId", "name", "description", "isSystem", "permissions")
SELECT gen_random_uuid()::text, t."id", 'Akses Penuh',
       'Semua akses kecuali khusus pemilik.', true,
       ARRAY['inbox.lihat','inbox.balas','inbox.tugaskan','inbox.catatan','inbox.tag','inbox.template_kirim','inbox.media',
             'pipeline.lihat','pipeline.kelola','kampanye.lihat','kampanye.kelola',
             'template.lihat','template.kelola',
             'produk.lihat','produk.kelola','inventaris.lihat','inventaris.kelola','pesanan.lihat','pesanan.kelola',
             'kontak.lihat','kontak.kelola','tag.lihat','tag.kelola',
             'pengetahuan.kelola','memori.lihat','memori.kelola','sumberdata.kelola','impor.kelola',
             'agent.lihat','agent.kelola','skenario.lihat','skenario.kelola',
             'approval.lihat','approval.putuskan','tiket.lihat','tiket.kelola',
             'kpi.lihat','aktivitas.lihat',
             'saluran.lihat','saluran.tambah','saluran.ubah','saluran.hapus','webhook.lihat']
FROM "Tenant" t;

INSERT INTO "Role" ("id", "tenantId", "name", "description", "isSystem", "permissions")
SELECT gen_random_uuid()::text, t."id", 'Admin Chat',
       'Operator chat: aksi penuh di percakapan, kontak, pipeline, tiket, dan template.', true,
       ARRAY['inbox.lihat','inbox.balas','inbox.tugaskan','inbox.catatan','inbox.tag','inbox.template_kirim','inbox.media',
             'kontak.kelola','pipeline.kelola','tiket.kelola','template.kelola','aktivitas.lihat']
FROM "Tenant" t;

-- 5. Legacy STAFF users and open invites map to Akses Penuh (owner decision
-- 2026-11-23: nobody loses access on upgrade; owners trim down).
UPDATE "User" u SET "roleId" = (
  SELECT r."id" FROM "Role" r
  WHERE r."tenantId" = u."tenantId" AND r."name" = 'Akses Penuh'
) WHERE u."role" = 'STAFF';

UPDATE "TeamInvite" i SET "roleId" = (
  SELECT r."id" FROM "Role" r
  WHERE r."tenantId" = i."tenantId" AND r."name" = 'Akses Penuh'
) WHERE i."role" = 'STAFF';

-- 6. One card per customer (PRD 29 section 6.3): backfill the deal's
-- contact from its conversation, then swap the uniqueness.
UPDATE "Deal" d SET "contactId" = (
  SELECT c."contactId" FROM "Conversation" c WHERE c."id" = d."conversationId"
);
CREATE UNIQUE INDEX "Deal_tenantId_contactId_key" ON "Deal"("tenantId", "contactId");

-- Thread per channel (PRD 29 section 6.2): the channel joins the identity.
DROP INDEX "Conversation_tenantId_customerPhone_key";
CREATE UNIQUE INDEX "Conversation_tenantId_customerPhone_channelId_key" ON "Conversation"("tenantId", "customerPhone", "channelId");

-- 7. Retire the old realm.
ALTER TABLE "User" DROP COLUMN "canRunCampaigns",
                    DROP COLUMN "role";
ALTER TABLE "TeamInvite" DROP COLUMN "role";
DROP TYPE "UserRole";

-- 8. Late FKs (added after the data moves so the seed updates never fight them).
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9. RLS coverage for the two new tenant-scoped tables (same idempotent
-- block as 20261101000400 / 20261101000800).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname
          AND col.column_name = 'tenantId'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING ("tenantId" = current_setting(''app.current_tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant_id'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
