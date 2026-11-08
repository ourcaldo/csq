-- Per-tenant OpenClaw cell connection (PRD §5/§26: one isolated cell per tenant).
-- Provisioned by the platform at tenant creation. All columns nullable so
-- existing tenants remain valid until a cell is provisioned for them.

ALTER TABLE "Tenant" ADD COLUMN "openclawCellId" TEXT,
ADD COLUMN "openclawBaseUrl" TEXT,
ADD COLUMN "openclawToken" TEXT,
ADD COLUMN "cellStatus" TEXT;
