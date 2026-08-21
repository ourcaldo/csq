import { google } from "googleapis";
import type { ParsedSheet } from "@/services/excel";
import type { OAuthCredentials, SpreadsheetRef } from "@/types/sheets";

// Google Sheets OAuth + read service (PRD §8.3). One module per integration;
// server-only — GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI are server secrets and
// never reach the client bundle.

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets", // read + write (writeSheet is opt-in per source)
  "https://www.googleapis.com/auth/drive.readonly",
];

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token on re-consent
    scope: SCOPES,
    state,
  });
}

export async function handleOAuthCallback(code: string): Promise<OAuthCredentials> {
  const oauth = oauthClient();
  const { tokens } = await oauth.getToken(code);
  return {
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? undefined,
    expiryDate: tokens.expiry_date ?? undefined,
  };
}

function authedClient(creds: OAuthCredentials) {
  const oauth = oauthClient();
  oauth.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expiry_date: creds.expiryDate,
  });
  // google-auth-library auto-refreshes using the refresh_token when the
  // access_token expires — no manual refresh loop needed.
  return oauth;
}

export async function listSpreadsheets(
  creds: OAuthCredentials
): Promise<SpreadsheetRef[]> {
  const drive = google.drive({ version: "v3", auth: authedClient(creds) });
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id, name)",
    pageSize: 100,
  });
  const files = res.data.files ?? [];
  return files
    .filter((f): f is { id: string; name: string } => Boolean(f.id) && Boolean(f.name))
    .map((f) => ({ id: f.id, name: f.name }));
}

// List the tab (sheet) titles within a spreadsheet, so the owner can pick which
// tab to import after choosing a spreadsheet. The connect step needs a
// sheetName, and reading "the whole file" isn't an option with the Sheets API.
export async function listSheets(
  creds: OAuthCredentials,
  spreadsheetId: string
): Promise<string[]> {
  const sheets = google.sheets({ version: "v4", auth: authedClient(creds) });
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = res.data.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? [];
  return titles.filter((t): t is string => typeof t === "string");
}

export async function readSheet(
  creds: OAuthCredentials,
  spreadsheetId: string,
  range: string
): Promise<ParsedSheet> {
  const sheets = google.sheets({ version: "v4", auth: authedClient(creds) });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = res.data.values ?? [];
  if (values.length === 0) return { headers: [], rows: [] };

  const headerRow = values[0] ?? [];
  const headers = headerRow
    .map((v) => String(v ?? "").trim())
    .map((h, i) => h || `col${i + 1}`);

  const rows = values.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? null;
    });
    return obj;
  });

  return { headers, rows };
}

// Write values to a range (plan 4.3). Only used when write capability is
// explicitly enabled for a source — the MVP sync loop is read-only; this is
// here for future "push stock back to the sheet" flows. Values are typed as
// primitives so the googleapis request body type-checks without a cast.
type CellValue = string | number | boolean | null;

export async function writeSheet(
  creds: OAuthCredentials,
  spreadsheetId: string,
  range: string,
  values: CellValue[][]
): Promise<void> {
  const sheets = google.sheets({ version: "v4", auth: authedClient(creds) });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

