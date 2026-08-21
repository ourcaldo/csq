import { z } from "zod";

// Google Sheets OAuth + connection types (PRD §8.3). OAuth credentials live
// at the tenant level in Tenant.settings.googleSheets (see lib/google-connect),
// NOT in each DataSource — one Google connection powers many spreadsheets.
// DataSource.config holds only the per-spreadsheet selection + column mapping.

export type OAuthCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
};

export type SpreadsheetRef = {
  id: string;
  name: string;
};

export const sheetsConnectSchema = z.object({
  sourceId: z.string().uuid(),
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
  range: z.string().optional(),
});
export type SheetsConnectInput = z.infer<typeof sheetsConnectSchema>;

export const sheetsConfirmSchema = z.object({
  sourceId: z.string().uuid(),
  name: z.string().min(1).optional(),
  mapping: z.object({
    name: z.string().nullable(),
    price: z.string().nullable(),
    quantity: z.string().nullable(),
    sku: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
});
export type SheetsConfirmInput = z.infer<typeof sheetsConfirmSchema>;

export const sheetsSyncSchema = z.object({
  sourceId: z.string().uuid(),
});
export type SheetsSyncInput = z.infer<typeof sheetsSyncSchema>;

// DataSource.config Json shape for GOOGLE_SHEETS sources — the per-spreadsheet
// selection + column mapping only (no OAuth tokens; those live on the tenant).
// Parsed with Zod (never `as`) at every read — the DB Json column is an
// external boundary. Zod strips unknown keys, so legacy sources that still
// carry token fields parse fine.
export const sheetsSourceConfigSchema = z.object({
  spreadsheetId: z.string(),
  sheetName: z.string(),
  range: z.string().optional(),
  mapping: z.object({
    name: z.string().nullable(),
    price: z.string().nullable(),
    quantity: z.string().nullable(),
    sku: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
});
export type SheetsSourceConfig = z.infer<typeof sheetsSourceConfigSchema>;
