// PRD 14 amendment 2026-11-28: an ISSUED invoice unpaid more than
// OVERDUE_GRACE_DAYS past its due date downgrades the tenant to the Free
// entitlements (plan stashed on Tenant.overduePlanId) until every invoice is
// paid or voided. The decision is pure so the scheduler tick and the
// self-check share one rule.
export const OVERDUE_GRACE_DAYS = 7;

const OVERDUE_GRACE_MS = OVERDUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

export function overdueCutoff(now = new Date()): Date {
  return new Date(now.getTime() - OVERDUE_GRACE_MS);
}

export function isInvoiceOverdue(dueAt: Date, now = new Date()): boolean {
  return dueAt.getTime() < overdueCutoff(now).getTime();
}
