import { z } from "zod";

// Google Sheets OAuth + connection types (PRD §8.3). OAuth credentials are
// stored per-tenant in DataSource.config (Json), never in .env.

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

// DataSource.config Json shape for GOOGLE_SHEETS sources. Parsed with Zod
// (never `as`) at every read — the DB Json column is an external boundary.
export const sheetsSourceConfigSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiryDate: z.number().optional(),
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
