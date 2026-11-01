# Phase 4 — Data Ingestion (Excel/CSV, Google Sheets)

**Goal:** Enable UMKM owners to import business data from Excel/CSV files and
connect Google Sheets as a live data source. Includes column detection, mapping
preview, and sync tracking.
**PRD Reference:** Sections 8.2, 8.3, 15.3
**Depends On:** Phase 1, Phase 3

---

## Tasks

### 4.1 Excel/CSV upload service

- [ ] Create `src/services/excel.ts`:
  - `parseFile(buffer: Buffer): Promise<ParsedSheet[]>` — reads Excel/CSV using
    `exceljs`, returns array of sheets with headers and rows.
  - `detectColumns(headers: string[]): ColumnMapping[] — infers likely
    column semantics from Indonesian headers:
    - `Nama Barang`, `Nama Produk`, `Product` → `name`
    - `Harga`, `Harga Jual`, `Price` → `price`
    - `Stok`, `Sisa`, `Stock` → `quantity`
    - `SKU`, `Kode` → `sku`
    - `Deskripsi`, `Description` → `description`
  - Returns confidence score per mapping.
- [ ] Support `.xlsx`, `.xls`, `.csv` file types.
- [ ] Zod-validate parsed output.

### 4.2 Excel/CSV import API route

- [ ] Create `src/pages/api/import/excel.ts`:
  - `POST` — multipart form upload.
  - Accept file, parse with `excel.ts`, detect columns, return mapping preview.
- [ ] Create `src/pages/api/import/excel/confirm.ts`:
  - `POST` — receives confirmed mapping + file reference.
  - Upserts products and inventory based on mapping.
  - Creates a `DataSource` record (type: `EXCEL`).
  - Returns import summary (created/updated counts, errors).
- [ ] All routes authenticated and tenant-scoped.
- [ ] Zod schemas for mapping confirmation payload.

### 4.3 Google Sheets OAuth setup

- [ ] Create `src/services/sheets.ts`:
  - `getAuthUrl(tenantId: string): string` — generates Google OAuth URL with
    scopes: `readonly` for spreadsheets, `openid` for identity.
  - `handleOAuthCallback(code: string): Promise<OAuthCredentials>` — exchanges
    code for tokens.
  - `listSpreadsheets(credentials: OAuthCredentials): Promise<Spreadsheet[]>`.
  - `readSheet(spreadsheetId, range): Promise<ParsedSheet>` — reads rows.
  - `writeSheet(spreadsheetId, range, values): Promise<void>` — writes back
    (only when write capability is explicitly enabled).
- [ ] Store OAuth credentials in `DataSource.config` (json column).
  - Credentials include: accessToken, refreshToken, expiryDate.
  - Refresh logic when token expires.
- [ ] `googleapis` library — use `google.auth.OAuth2` + `google.sheets("v4")`.

### 4.4 Google Sheets OAuth flow routes

- [ ] Create `src/pages/api/import/sheets/auth.ts`:
  - `GET` — redirects to Google OAuth consent screen.
- [ ] Create `src/pages/api/import/sheets/callback.ts`:
  - `GET` — handles OAuth callback, stores credentials, redirects back to
    dashboard with success/error.

### 4.5 Google Sheets connection management

- [ ] Create `src/pages/api/import/sheets/connect.ts`:
  - `POST` — after OAuth, let user pick spreadsheet + sheet.
  - Detect columns (reuse column detection from `excel.ts`).
  - Return mapping preview.
- [ ] Create `src/pages/api/import/sheets/confirm.ts`:
  - `POST` — confirm mapping, create `DataSource` record.
- [ ] Create `src/pages/api/import/sheets/sync.ts`:
  - `POST` — trigger manual sync from connected sheet.
  - Reads latest data, upserts products/inventory.
  - Updates `DataSource.lastSyncAt`.

### 4.6 Periodic sync with node-cron

- [ ] Create `src/services/scheduler.ts`:
  - On app startup (`src/pages/_app.tsx` or dedicated init), register a
    `node-cron` job that runs every 15 minutes.
  - For each active `GOOGLE_SHEETS` DataSource:
    - Read latest data from sheet.
    - Upsert into products/inventory.
    - Update `lastSyncAt`.
    - Log sync result.
  - Runs in-process (no Redis/task queue — PRD constraint).
- [ ] Only runs in server context, never on client.

### 4.7 Sync error handling

- [ ] If a sync fails, set `DataSource.status = ERROR` and log the error.
- [ ] Retry on next scheduled run.
- [ ] Dashboard shows error state (Phase 8 will render this).

### 4.8 Source priority tracking

- [ ] Create `src/pages/api/dashboard/sources/priority.ts`:
  - `GET` — return current source priority config for tenant.
  - `PUT` — update priority order (see PRD section 13).
- [ ] Store priority in a `SourcePriority` model or tenant settings JSON.
  - **Recommendation:** add a `settings` json column to `Tenant` model
    for simple key-value config. Avoid a separate model for MVP.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Manual test: upload Excel file → get column mapping preview → confirm import
  → products appear in database.
- [ ] Manual test: Google Sheets OAuth flow completes → sheet data visible.
- [ ] Manual test: `node-cron` scheduler logs sync attempts.

---

## Files Created/Modified

```
src/
├── pages/api/import/
│   ├── excel.ts                 (upload + preview)
│   ├── excel/confirm.ts        (confirm import)
│   ├── sheets/
│   │   ├── auth.ts             (OAuth redirect)
│   │   ├── callback.ts         (OAuth callback)
│   │   ├── connect.ts          (sheet selection + mapping)
│   │   ├── confirm.ts          (confirm connection)
│   │   └── sync.ts             (manual sync trigger)
├── pages/api/dashboard/sources/
│   └── priority.ts             (source priority config)
├── services/
│   ├── excel.ts                (parse, detect columns)
│   ├── sheets.ts               (OAuth, read, write, refresh)
│   └── scheduler.ts            (node-cron periodic sync)
├── types/
│   ├── import.ts               (mapping types, Zod schemas)
│   └── sheets.ts               (OAuth types, spreadsheet types)
```

---

## Notes

- Column detection doesn't need to be perfect — it's a best-effort inference.
  The mapping preview step lets the user correct any mistakes.
- Google Sheets OAuth credentials are stored in the database, not in `.env`.
  They're per-tenant. The `DataSource.config` json column holds them.
- For MVP, only product + inventory sync. Order sync from Sheets is out of scope.
- The `node-cron` scheduler starts when the Next.js server starts. It does NOT
  run during `next build` (server-side only code check).
