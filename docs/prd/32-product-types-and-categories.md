# PRD 32 - Product Types, Categories, and Stock vs Quota

Status: DRAFT - written 2026-11-26 from the owner's direction. Not yet
approved; section 8 needs the owner's answers before implementation.

Related: PRD 02 section 9-12 (capability model, inventory authority),
PRD 16 FEA-7 (product/inventory list), PRD 08 (RLS on new tenant
tables), PRD 31 (same staged flow: PRD first, then build).

## 1. Problem

Every product today is forced to behave like a physical stock item:

- `order.create` treats a missing Inventory row as stock 0, so the agent
  can never sell a product without stock. A tenant selling programs
  (Titik Nol English Course) or digital goods cannot use the order flow
  at all.
- The Produk form always collects stock, and the dashboard stats
  ("nilai stok", "stok habis") assume quantity.
- There is no product grouping (category) and no product type.

## 2. Owner direction (2026-11-26)

1. Products get a TYPE, with fields driven by that type:
   1. Produk Fisik
   2. Produk Digital
   3. Produk Downloadable
   4. Course / Program
2. Products get a tenant-defined CATEGORY for grouping.
3. Quota (course seats / slots) is the SAME concept as stock: the
   Inventory row. Question raised: is Inventory redundant? Answer in 4.3:
   no - keep it as the single quantity ledger, type decides whether a
   product has one.

## 3. Goals

1. A product type that changes which fields exist, whether stock/quota
   applies, and how the agent talks about availability.
2. Tenant-defined categories for grouping and filtering.
3. One quantity mechanism for both stok (PHYSICAL) and kuota (COURSE):
   the existing Inventory row, with its locking, oversell protection,
   cancel-restore, imports, and source priority. No parallel "quota"
   table.
4. Digital/downloadable products are sellable end to end by the agent
   with unlimited availability.

## 4. Data model

### 4.1 Product type

```
enum ProductType { PHYSICAL  DIGITAL  DOWNLOADABLE  COURSE }
Product.type        ProductType  (backfilled PHYSICAL)
```

DB values English; UI labels Indonesian: Produk Fisik, Produk Digital,
Produk Unduhan (Downloadable), Kursus/Program.

### 4.2 Category

```
model ProductCategory {
  id        String   @id @default(uuid())
  tenantId  String
  name      String
  createdAt DateTime @default(now())
  tenant    Tenant   @relation(...)
  products  Product[]
  @@unique([tenantId, name])
}
Product.categoryId String?   // FK, nullable - category optional in v1
```

New tenant table: gets `tenantId`, RLS policy (pattern of the 2026-11-23
RLS set), index on tenantId. Categories are flat (no hierarchy).

### 4.3 Inventory stays - it is not redundant

Inventory is the quantity LEDGER, not a product attribute: canonical
quantity + source (MANUAL/EXCEL/GOOGLE_SHEETS) + sourceRef +
InventorySnapshot per source + source-priority arbitration (PRD 02
section 12). Product and Inventory stay one-to-one; which products HAVE
a row is decided by type:

- tracked (has an Inventory row): PHYSICAL (stok), COURSE (kuota)
- untracked (no row): DIGITAL, DOWNLOADABLE (unlimited availability)

No `trackStock` boolean - the type IS the switch, so no state can
contradict itself.

### 4.4 Type-specific fields

Additive, all nullable, validated per type at the API boundary:

| Column | Used by | Meaning |
|---|---|---|
| `deliveryInfo` | DIGITAL, DOWNLOADABLE | How the buyer gets it: download link, license code, account instructions. UI label differs per type ("Tautan unduhan" / "Cara pengiriman"). |
| `durationLabel` | COURSE | Free text, e.g. "8 pertemuan" |
| `scheduleLabel` | COURSE | Free text, e.g. "Selasa & Kamis 19.00 WIB" |

PHYSICAL keeps what it has today: sku, price, description, stock.

### 4.5 Migration and backfill

- New enum + 3 nullable columns + `categoryId` FK + `ProductCategory`
  table + RLS policy for the new table.
- Backfill: every existing product `type = PHYSICAL` (they all carry
  stock today), `categoryId = NULL`.
- Seed: demo tenant gets two categories (e.g. "Biji Kopi", "Perlengkapan")
  and its seeded products are categorized PHYSICAL.

## 5. Behavior matrix

| | PHYSICAL | COURSE | DIGITAL | DOWNLOADABLE |
|---|---|---|---|---|
| Quantity | stok (Inventory) | kuota (Inventory) | none | none |
| order.create | validate + decrement | validate + decrement | skip stock | skip stock |
| order.cancel | restore | restore | nothing | nothing |
| Agent wording | "stok habis" | "kuota penuh" | "tersedia" | "tersedia" |
| inventory.read | quantity | quantity | "tidak berlaku" | "tidak berlaku" |
| inventory.update | yes | yes | refused | refused |
| Inventaris page | listed (Stok) | listed (Kuota) | hidden | hidden |

### 5.1 Order flow

- Mixed baskets are fine: tracked items go through the existing
  FOR UPDATE lock / validate / decrement pass; untracked items skip it.
- The `order.create` result includes per-item fulfillment text for
  untracked types (deliveryInfo, duration/schedule) so the agent can
  tell the buyer how they receive the product. Bounded to the order's
  items - no new tool.
- Oversell protection for tracked types is unchanged.

### 5.2 Agent tools

- `product.search` / `product.read`: results carry type, category, and
  availability in the type's vocabulary ("sisa kuota 3", "tersedia
  tanpa batas").
- `inventory.read` on an untracked product answers explicitly that
  stock does not apply - never "0".
- Tool contracts otherwise unchanged; permission keys unchanged
  (produk.kelola / inventaris.kelola).

### 5.3 Dashboard

- Produk page: type badge + category filter + per-type composer fields.
  The editor follows the owner UI rules (full page, no modal) - the
  current Produk form dialog gets replaced by the same view-based
  composer pattern used by Pengetahuan (PRD 31).
- Kategori management in v1: inline add from the product composer
  ("+ kategori baru"); rename/delete deferred (see 8.3).
- Inventaris page: only tracked products; quantity column header reads
  "Stok / Kuota"; shows the product type.
- Produk stats: "stok habis" counts only tracked products; untracked
  products never appear in valuation.

### 5.4 Imports (Excel / Google Sheets)

- Imported products default to PHYSICAL; the stock column stays optional
  as today (import without stock column = no inventory row, which under
  the new model means PHYSICAL with stock unset - flagged at 8.5).

## 6. Non-goals (v1)

- Shipping weight/dimensions for PHYSICAL.
- Actual file hosting or automatic delivery for DOWNLOADABLE
  (deliveryInfo is a link/note in v1).
- Course scheduling, attendance, enrollment records; duration/schedule
  are display text.
- Per-variant SKUs, bundles, subscription pricing.
- Category hierarchy.

## 7. Verification plan

1. Migration on the clone; existing products all PHYSICAL with their
   inventory rows intact; `knowledge`-style live UI check.
2. Create a COURSE product with kuota 2 as the demo owner; order 3 via
   the API/agent path - the third must fail with "kuota penuh"; cancel
   one order - kuota restores.
3. Create a DIGITAL product with deliveryInfo; order it as a customer -
   no stock error; agent reply carries the delivery info.
4. `inventory.read` on the digital product answers "tidak berlaku";
   Inventaris page does not list it.
5. Category: create two categories inline, filter the Produk list by
   category, verify grouping.
6. Regression: PHYSICAL order flow identical to today (lock, decrement,
   cancel restore, import sync).

## 8. Open decisions (owner)

1. DIGITAL vs DOWNLOADABLE semantics - proposal: DIGITAL is fulfilled by
   the business (akun, kode lisensi, akses manual), DOWNLOADABLE is a
   file/link the buyer downloads themselves. Confirm or merge.
2. Course fields: is `durasi` + `jadwal` (free text) enough for v1, or
   add lokasi/level?
3. Category: optional on products (recommended) - and is inline-add
   enough for v1, or do you want a category manage UI (rename/delete)
   right away?
4. Changing a product's type after creation: allowed only while it has
   no orders (recommended - switching COURSE to DIGITAL would orphan the
   kuota), or locked forever after first order?
5. Imported rows without a stock column: keep them PHYSICAL-without-row
   (they act sold-out until stock is set - current behavior), or treat
   missing stock as a hint to make them DIGITAL? (Recommend keep
   PHYSICAL; explicit is safer.)
