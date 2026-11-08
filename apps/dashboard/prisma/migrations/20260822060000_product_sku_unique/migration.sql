-- M13: Enforce uniqueness of (tenantId, sku) on Product so SKU lookups have a
-- uniqueness guarantee and imports can't create duplicate-SKU products per
-- tenant. NULL skus are allowed (Postgres treats NULLs as distinct in a UNIQUE
-- index), so products without a SKU don't conflict.
--
-- If a tenant already has duplicate non-null SKUs, resolve them before applying
-- this migration — the CREATE UNIQUE INDEX will fail on existing duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");
