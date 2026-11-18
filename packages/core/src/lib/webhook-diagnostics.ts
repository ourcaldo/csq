// Bounded in-memory diagnostics for the WhatsApp webhook. Records why an
// inbound POST was rejected (signature mismatch / missing secret / unknown
// phone_number_id) so the failure is observable from the dashboard without
// crawling server logs. Memory-only + capped: a spoofer spamming the webhook
// can't flood the DB, and entries reset on redeploy (fine for diagnosis).

export type WebhookDiagKind =
  | "SIG_MISMATCH"
  | "NO_SECRET"
  | "UNKNOWN_PHONE_ID";

export type WebhookDiag = {
  at: string; // ISO time
  kind: WebhookDiagKind;
  // Owning tenant when the phone_number_id resolved to a channel (audit
  // run-1, webhook-diag-cross-tenant-leak): the BFF filters on this so one
  // tenant's OWNER never reads another's diagnostics. Absent for
  // UNKNOWN_PHONE_ID (no resolvable tenant) - those are excluded from
  // tenant views.
  tenantId?: string;
  phoneId?: string;
  // First 16 hex chars only - enough to compare against a locally recomputed
  // HMAC without dumping full signatures into the response.
  receivedSig?: string;
  computedSig?: string;
};

const MAX = 20;
const records: WebhookDiag[] = [];

export function recordWebhookDiag(rec: WebhookDiag): void {
  records.unshift(rec);
  if (records.length > MAX) records.pop();
}

// All entries (platform/operator use).
export function getWebhookDiags(): WebhookDiag[] {
  return records;
}

// Tenant-scoped entries: only records attributable to THIS tenant.
export function getTenantWebhookDiags(tenantId: string): WebhookDiag[] {
  return records.filter((r) => r.tenantId === tenantId);
}
