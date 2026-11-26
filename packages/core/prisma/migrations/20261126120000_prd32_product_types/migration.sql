-- PRD 32: product types (Fisik / Digital / Downloadable / Course), tenant
-- product categories, and course levels. PHYSICAL and COURSE keep their
-- Inventory row (stok / kuota); DIGITAL and DOWNLOADABLE have none.

CREATE TYPE "ProductType" AS ENUM ('PHYSICAL', 'DIGITAL', 'DOWNLOADABLE', 'COURSE');
CREATE TYPE "CourseDurationUnit" AS ENUM ('MINGGU', 'BULAN', 'TAHUN');

ALTER TABLE "Product" ADD COLUMN "type" "ProductType" NOT NULL DEFAULT 'PHYSICAL';
ALTER TABLE "Product" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "Product" ADD COLUMN "levelId" TEXT;
ALTER TABLE "Product" ADD COLUMN "deliveryInfo" TEXT;
ALTER TABLE "Product" ADD COLUMN "durationValue" INTEGER;
ALTER TABLE "Product" ADD COLUMN "durationUnit" "CourseDurationUnit";

CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseLevel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseLevel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductCategory_tenantId_name_key" ON "ProductCategory"("tenantId", "name");
CREATE INDEX "ProductCategory_tenantId_idx" ON "ProductCategory"("tenantId");
CREATE UNIQUE INDEX "CourseLevel_tenantId_name_key" ON "CourseLevel"("tenantId", "name");
CREATE INDEX "CourseLevel_tenantId_idx" ON "CourseLevel"("tenantId");
CREATE INDEX "Product_tenantId_categoryId_idx" ON "Product"("tenantId", "categoryId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "CourseLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseLevel" ADD CONSTRAINT "CourseLevel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: the same two policies every tenant table carries - tenant isolation
-- plus the system bypass (pattern of 20260818010000 + 20261123140000).
ALTER TABLE "ProductCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CourseLevel" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ProductCategory_tenant_isolation" ON "ProductCategory" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY "ProductCategory_bypass_rls" ON "ProductCategory" FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');

CREATE POLICY "CourseLevel_tenant_isolation" ON "CourseLevel" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY "CourseLevel_bypass_rls" ON "CourseLevel" FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');
