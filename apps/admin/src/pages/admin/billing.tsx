import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Plus } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel, idr, btnPrimary, btnOutline } from "@/components/console";
import { confirmAction } from "@/components/confirm-dialog";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Billing & revenue ledger (template viewBilling 1:1): financial telemetry
// strip, tab navigation (invoices / upgrade requests / bank & terms), inline
// settle-payment bar, destructive voids via the confirm dialog. The invoice
// composer lives at /admin/billing/new-invoice.

type Invoice = {
  id: string;
  number: string;
  tenantName: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  amountIdr: number;
  status: "ISSUED" | "PAID" | "VOID";
  dueAt: string;
  paidAt: string | null;
};
type Need = { tenantId: string; tenantName: string; planName: string | null; priceIdr: number };
type Request = {
  id: string;
  tenantName: string;
  tenantSlug: string;
  requestedPlanName: string;
  requestedPlanPrice: number;
  note: string | null;
  status: "NEW" | "CONTACTED" | "DONE" | "REJECTED";
  createdAt: string;
};
type Settings = {
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  dueDays: number;
  graceDays: number;
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function periodDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function BillingPage() {
  const router = useRouter();
  const { data, loading, error, refresh } = useAdminApi<{
    items: Invoice[];
    needsInvoice: Need[];
    monthStart: string;
  }>("/api/admin/invoices");
  const { data: requestsData, refresh: refreshRequests } = useAdminApi<{ items: Request[] }>(
    "/api/admin/plan-requests"
  );
  const { data: settings, refresh: refreshSettings } = useAdminApi<Settings>("/api/admin/billing-settings");

  const [tab, setTab] = useState<"invoices" | "requests" | "settings">("invoices");
  const [busy, setBusy] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    bankName: "", bankAccountNumber: "", bankAccountHolder: "", dueDays: "7", graceDays: "7",
  });

  useEffect(() => {
    if (!settings) return;
    setSettingsForm({
      bankName: settings.bankName ?? "",
      bankAccountNumber: settings.bankAccountNumber ?? "",
      bankAccountHolder: settings.bankAccountHolder ?? "",
      dueDays: String(settings.dueDays),
      graceDays: String(settings.graceDays),
    });
  }, [settings]);

  const invoices = data?.items ?? [];
  const needs = data?.needsInvoice ?? [];
  const requests = requestsData?.items ?? [];
  const now = new Date();
  const outstanding = invoices.filter((i) => i.status === "ISSUED").reduce((s, i) => s + i.amountIdr, 0);
  const overdueCount = invoices.filter((i) => i.status === "ISSUED" && new Date(i.dueAt) < now).length;
  const paidThisMonth = invoices
    .filter((i) => i.status === "PAID" && i.paidAt && new Date(i.paidAt) >= new Date(data?.monthStart ?? 0))
    .reduce((s, i) => s + i.amountIdr, 0);

  async function submitPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const inv = invoices.find((i) => i.id === payingId);
    if (!inv) return;
    const f = e.currentTarget;
    setBusy(inv.id);
    setActionError(null);
    try {
      await adminFetch("/api/admin/invoices", "PATCH", {
        id: inv.id,
        action: "paid",
        method: (f.elements.namedItem("pay-method-inline") as HTMLSelectElement).value,
        reference: (f.elements.namedItem("pay-ref-inline") as HTMLInputElement).value.trim() || undefined,
      });
      showToast(`Invoice ${inv.number} marked as Paid`);
      setPayingId(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to mark as paid.");
    } finally {
      setBusy(null);
    }
  }

  function askVoid(inv: Invoice) {
    confirmAction({
      title: "Void Invoice",
      desc: (
        <>
          Mark invoice <strong>{inv.number}</strong> ({idr(inv.amountIdr)}) for {inv.tenantName} as Void?
        </>
      ),
      btnLabel: "Void Invoice",
      onConfirm: () => {
        void adminFetch("/api/admin/invoices", "PATCH", { id: inv.id, action: "void" })
          .then(() => {
            showToast(`Invoice ${inv.number} voided`);
            refresh();
          })
          .catch((err: unknown) => setActionError(err instanceof Error ? err.message : "Failed to void."));
      },
    });
  }

  async function updateRequest(id: string, status: "CONTACTED" | "DONE" | "REJECTED") {
    setBusy(id);
    try {
      await adminFetch("/api/admin/plan-requests", "PATCH", { id, status });
      showToast(`Request marked ${status.toLowerCase()}`);
      refreshRequests();
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("settings");
    setActionError(null);
    try {
      await adminFetch("/api/admin/billing-settings", "PUT", {
        bankName: settingsForm.bankName || null,
        bankAccountNumber: settingsForm.bankAccountNumber || null,
        bankAccountHolder: settingsForm.bankAccountHolder || null,
        dueDays: parseInt(settingsForm.dueDays, 10) || 7,
        graceDays: parseInt(settingsForm.graceDays, 10) || 0,
      });
      showToast("Bank & payment terms saved");
      refreshSettings();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save the settings.");
    } finally {
      setBusy(null);
    }
  }

  const inpCls = "mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none";

  return (
    <AdminShell title="Billing">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Billing &amp; Revenue Ledger</h1>
          <p className="mt-1 text-xs text-slate-500">
            Issue tenant subscription invoices, settle bank transfers, and review upgrade requests.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/plans" className={btnOutline()}>
            Manage Plans
          </Link>
          <Link href="/admin/billing/new-invoice" className={btnPrimary()}>
            <Plus size={14} />
            Issue Invoice
          </Link>
        </div>
      </div>

      {/* Financial telemetry strip */}
      <div className="mt-6 grid grid-cols-1 border-y border-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-slate-200">
        <div className="py-3.5 pr-4">
          <p className="text-[11px] font-medium text-slate-400">Outstanding Receivables</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">{idr(outstanding)}</p>
        </div>
        <div className="border-t border-slate-200 py-3.5 sm:border-t-0 sm:px-5">
          <p className="text-[11px] font-medium text-slate-400">Overdue Invoices</p>
          <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${overdueCount > 0 ? "text-red-600" : "text-slate-900"}`}>
            {overdueCount}
          </p>
        </div>
        <div className="border-t border-slate-200 py-3.5 sm:border-t-0 sm:pl-5">
          <p className="text-[11px] font-medium text-slate-400">Settled Revenue</p>
          <p className="mt-1 font-mono text-lg font-semibold text-emerald-700 tabular-nums">{idr(paidThisMonth)}</p>
        </div>
      </div>

      {actionError && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {actionError}
        </div>
      )}
      {error && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Sub-navigation tabs */}
      <div className="mt-5 flex gap-6 border-b border-slate-200">
        <button type="button" onClick={() => setTab("invoices")} className={`tab-btn ${tab === "invoices" ? "active" : ""}`}>
          Invoices ({invoices.length})
        </button>
        <button type="button" onClick={() => setTab("requests")} className={`tab-btn ${tab === "requests" ? "active" : ""}`}>
          Upgrade Requests ({requests.length})
        </button>
        <button type="button" onClick={() => setTab("settings")} className={`tab-btn ${tab === "settings" ? "active" : ""}`}>
          Bank &amp; Terms
        </button>
      </div>

      {tab === "invoices" && (
        <>
          {needs.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-muted/80 px-4 py-2.5 text-xs text-slate-700">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span>
                  <strong className="font-semibold text-slate-900">Unbilled Cycle:</strong> {needs[0].tenantName} (
                  {needs[0].planName ?? "No plan"} - <span className="font-mono">{idr(needs[0].priceIdr)}</span>) has no
                  invoice for the current period.
                </span>
              </div>
              <Link
                href={`/admin/billing/new-invoice?tenant=${encodeURIComponent(needs[0].tenantId)}`}
                className="rounded-md border border-slate-300 bg-card px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                Create Invoice →
              </Link>
            </div>
          )}

          {payingId && (
            <form
              onSubmit={submitPayment}
              className="mt-5 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-muted/80 px-4 py-3 text-xs"
            >
              <span className="font-semibold text-slate-900">
                Settle Invoice <span className="font-mono">{invoices.find((x) => x.id === payingId)?.number}</span>:
              </span>
              <select id="pay-method-inline" className="h-8 rounded-md border border-slate-300 bg-card px-2.5 text-xs">
                <option value="TRANSFER">Bank Transfer (BCA)</option>
                <option value="CASH">Cash</option>
                <option value="OTHER">Other</option>
              </select>
              <input
                id="pay-ref-inline"
                type="text"
                placeholder="Transfer reference (optional)"
                className="h-8 w-52 rounded-md border border-slate-300 bg-card px-2.5 font-mono text-xs"
              />
              <button
                type="submit"
                disabled={busy === payingId}
                className="rounded-md bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {busy === payingId ? "Saving..." : "Confirm Paid"}
              </button>
              <button
                type="button"
                onClick={() => setPayingId(null)}
                className="rounded-md border border-slate-300 bg-card px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </form>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3 pr-4">Invoice #</th>
                  <th className="px-4 py-3">Tenant &amp; Tier</th>
                  <th className="px-4 py-3">Billing Period</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Due / Paid Date</th>
                  <th className="py-3 pl-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                {loading && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                      Loading...
                    </td>
                  </tr>
                )}
                {invoices.map((inv) => {
                  const overdue = inv.status === "ISSUED" && new Date(inv.dueAt) < now;
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80">
                      <td className="py-3.5 pr-4 font-mono font-medium text-slate-700">{inv.number}</td>
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-slate-900">{inv.tenantName}</p>
                        <p className="text-[11px] text-slate-400">{inv.planName}</p>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600">
                        {periodDate(inv.periodStart)} - {periodDate(inv.periodEnd)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {idr(inv.amountIdr)}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusLabel
                          tone={inv.status === "PAID" ? "ok" : inv.status === "VOID" ? "off" : overdue ? "bad" : "warn"}
                        >
                          {inv.status === "PAID" ? "Paid" : inv.status === "VOID" ? "Void" : overdue ? "Overdue" : "Unpaid"}
                        </StatusLabel>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-500">
                        {inv.paidAt ? date(inv.paidAt) : date(inv.dueAt)}
                      </td>
                      <td className="py-3.5 pl-4 text-right">
                        {inv.status === "ISSUED" ? (
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setPayingId(inv.id);
                              }}
                              className="font-semibold text-emerald-700 hover:underline"
                            >
                              Mark Paid
                            </button>
                            <button type="button" onClick={() => askVoid(inv)} className="font-medium text-red-600 hover:underline">
                              Void
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && invoices.length === 0 && !error && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                      No invoices yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "requests" && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 pr-4">Tenant</th>
                <th className="px-4 py-3">Requested Plan</th>
                <th className="px-4 py-3">Operator Note</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="py-3 pl-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="py-3.5 pr-4">
                    <p className="font-semibold text-slate-900">{r.tenantName}</p>
                    <p className="font-mono text-[11px] text-slate-400">{r.tenantSlug}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-semibold text-slate-900">{r.requestedPlanName}</span>{" "}
                    <span className="ml-1 font-mono text-slate-500">({idr(r.requestedPlanPrice)})</span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{r.note || "-"}</td>
                  <td className="px-4 py-3.5">
                    <StatusLabel tone={r.status === "DONE" ? "ok" : r.status === "REJECTED" ? "off" : "warn"}>
                      {r.status[0] + r.status.slice(1).toLowerCase()}
                    </StatusLabel>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-slate-500">{date(r.createdAt)}</td>
                  <td className="py-3.5 pl-4 text-right">
                    <div className="inline-flex items-center gap-3">
                      {r.status === "NEW" && (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => void updateRequest(r.id, "CONTACTED")}
                          className="font-medium text-slate-700 hover:underline disabled:opacity-40"
                        >
                          Contacted
                        </button>
                      )}
                      {(r.status === "NEW" || r.status === "CONTACTED") && (
                        <>
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => void updateRequest(r.id, "DONE")}
                            className="font-semibold text-emerald-700 hover:underline disabled:opacity-40"
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => void updateRequest(r.id, "REJECTED")}
                            className="font-medium text-red-600 hover:underline disabled:opacity-40"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {(r.status === "DONE" || r.status === "REJECTED") && <span className="text-slate-300">-</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "settings" && (
        <form onSubmit={saveSettings} className="divide-y divide-slate-200">
          <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
            <div className="md:col-span-4">
              <span className="text-xs font-semibold text-slate-900">Settlement Bank Account</span>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Displayed on tenant billing pages for manual bank transfer settlement.
              </p>
            </div>
            <div className="grid max-w-2xl grid-cols-1 gap-3.5 sm:grid-cols-3 md:col-span-8">
              <div>
                <label className="block text-xs font-medium text-slate-700">Bank Name</label>
                <input
                  type="text"
                  value={settingsForm.bankName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, bankName: e.target.value })}
                  placeholder="BCA"
                  className={inpCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Account Number</label>
                <input
                  type="text"
                  value={settingsForm.bankAccountNumber}
                  onChange={(e) => setSettingsForm({ ...settingsForm, bankAccountNumber: e.target.value })}
                  placeholder="1234567890"
                  className={`${inpCls} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Account Holder</label>
                <input
                  type="text"
                  value={settingsForm.bankAccountHolder}
                  onChange={(e) => setSettingsForm({ ...settingsForm, bankAccountHolder: e.target.value })}
                  placeholder="PT CSQ Indonesia"
                  className={inpCls}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
            <div className="md:col-span-4">
              <span className="text-xs font-semibold text-slate-900">Net Payment &amp; Grace Window</span>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Days before an issued invoice becomes overdue and grace period prior to auto-suspension.
              </p>
            </div>
            <div className="grid max-w-xs grid-cols-2 gap-3.5 md:col-span-8">
              <div>
                <label className="block text-xs font-medium text-slate-700">Due Days</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={settingsForm.dueDays}
                  onChange={(e) => setSettingsForm({ ...settingsForm, dueDays: e.target.value })}
                  className={`${inpCls} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Grace Days</label>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={settingsForm.graceDays}
                  onChange={(e) => setSettingsForm({ ...settingsForm, graceDays: e.target.value })}
                  className={`${inpCls} font-mono`}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-5">
            <button type="submit" disabled={busy === "settings"} className={btnPrimary("px-4 py-2")}>
              {busy === "settings" ? "Saving..." : "Save Billing Settings"}
            </button>
          </div>
        </form>
      )}
    </AdminShell>
  );
}
