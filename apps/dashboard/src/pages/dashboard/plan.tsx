import { useState } from "react";
import type { GetServerSideProps } from "next";
import { X } from "@phosphor-icons/react";
import {
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABELS,
  type PlanFeature,
} from "@csq/core/types/entitlements";
import { requireAuth } from "@csq/core/lib/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useApi } from "@/hooks/use-api";
import { apiSend } from "@/lib/api-client";
import { Button } from "@csq/ui/components/ui/button";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Textarea } from "@csq/ui/components/ui/textarea";

type Plan = {
  id: string;
  name: string;
  priceIdr: number;
  aiCreditsPerMonth: number | null;
  mauLimit: number | null;
  staffLimit: number | null;
  channelLimit: number | null;
  features: string[];
};

type Invoice = {
  id: string;
  number: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  amountIdr: number;
  status: "ISSUED" | "PAID" | "VOID";
  dueAt: string;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
};

type Billing = {
  entitlements: {
    planName: string | null;
    aiCreditsPerMonth: number | null;
    mauLimit: number | null;
    staffLimit: number | null;
    channelLimit: number | null;
    features: PlanFeature[];
  };
  usage: {
    mau: number;
    agentReplies: number;
    scenarioCredits: number;
    creditsUsed: number;
    replyCredits: number;
    moduleCredits: number;
    staff: number;
    channels: number;
  };
  monthStart: string;
  invoices: Invoice[];
  plans: Plan[];
  openRequest: {
    id: string;
    requestedPlanId: string;
    requestedPlanName: string;
    status: string;
    note: string | null;
    createdAt: string;
  } | null;
  latestRequest: {
    id: string;
    requestedPlanId: string;
    requestedPlanName: string;
    status: string;
    createdAt: string;
  } | null;
  bank: { name: string; accountNumber: string; accountHolder: string } | null;
  dueDays: number;
  graceDays: number;
};

export const getServerSideProps: GetServerSideProps = requireAuth({
  requiredRole: "OWNER",
});

function idr(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function num(n: number): string {
  return n.toLocaleString("id-ID");
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Invoice periods are calendar dates stored at UTC boundaries.
function periodDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function limitLabel(v: number | null): string {
  return v === null ? "Tanpa batas" : num(v);
}

function UsageCell({
  label,
  used,
  limit,
  note,
  subs,
}: {
  label: string;
  used: number;
  limit: number | null;
  note?: string;
  subs?: { label: string; used: number }[];
}) {
  const pct = limit === null ? null : Math.min(100, Math.round((used / limit) * 100));
  const tone =
    pct === null ? "" : pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-green-600";
  return (
    <div className="bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-slate-900">
        {num(used)}
        {limit !== null && (
          <span className="text-[11px] font-normal text-slate-400"> / {num(limit)}</span>
        )}
      </p>
      {pct === null ? (
        <p className="mt-2 text-[11px] text-slate-400">Tanpa batas</p>
      ) : (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {subs && subs.length > 0 && (
        <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
          {subs.map((s) => {
            const subPct =
              limit === null ? null : Math.min(100, Math.round((s.used / limit) * 100));
            return (
              <div key={s.label}>
                <div className="flex items-center justify-between text-[10.5px] text-slate-400">
                  <span>{s.label}</span>
                  <span className="font-mono tabular-nums">{num(s.used)}</span>
                </div>
                {subPct !== null && (
                  <div className="mt-0.5 h-[3px] w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-300"
                      style={{ width: `${subPct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {note && <p className="mt-2 text-[10.5px] text-slate-400">{note}</p>}
    </div>
  );
}

function InvoiceStatus({ status }: { status: Invoice["status"] }) {
  const cls =
    status === "PAID"
      ? "bg-green-50 text-green-700"
      : status === "VOID"
        ? "bg-slate-100 text-slate-500"
        : "bg-amber-50 text-amber-700";
  const label = status === "PAID" ? "Lunas" : status === "VOID" ? "Dibatalkan" : "Belum dibayar";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function PlanPage() {
  const { data, loading, error, refresh } = useApi<Billing>("/api/dashboard/billing");
  const [showCatalog, setShowCatalog] = useState(false);
  const [requestPlan, setRequestPlan] = useState<Plan | null>(null);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submitRequest() {
    if (!requestPlan) return;
    setBusy(true);
    setFormError(null);
    try {
      await apiSend("/api/dashboard/billing", "POST", {
        planId: requestPlan.id,
        note: note.trim() || undefined,
      });
      setRequestPlan(null);
      setNote("");
      setShowCatalog(false);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengirim permintaan.");
    } finally {
      setBusy(false);
    }
  }

  const entitlements = data?.entitlements;
  const usage = data?.usage;
  const planName = entitlements?.planName ?? null;
  const currentPrice = data?.plans.find((p) => p.name === planName)?.priceIdr ?? null;
  const otherPlans = (data?.plans ?? []).filter((p) => p.name !== planName);
  const excludedFeatures = entitlements
    ? PLAN_FEATURE_KEYS.filter((k) => !entitlements.features.includes(k))
    : [];
  // BIL-1 (PRD 16): unpaid first, then paid, then void; period order kept.
  const invoiceOrder: Record<Invoice["status"], number> = { ISSUED: 0, PAID: 1, VOID: 2 };
  const sortedInvoices = [...(data?.invoices ?? [])].sort(
    (a, b) => invoiceOrder[a.status] - invoiceOrder[b.status]
  );

  return (
    <DashboardShell
      title="Paket & Kuota"
      description="Paket aktif, pemakaian bulan ini, dan tagihan Anda."
    >
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && <p className="text-sm text-slate-400">Memuat paket...</p>}

      {data && entitlements && usage && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Paket aktif
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                    {planName ?? "Tanpa paket"}
                  </h2>
                  {planName && currentPrice !== null && (
                    <span className="text-sm text-slate-500">{idr(currentPrice)} / bulan</span>
                  )}
                </div>
                {!planName && (
                  <p className="mt-1 text-sm text-slate-500">
                    Semua fitur aktif, tanpa batas.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {entitlements.features.length === 0 ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                      Fitur core
                    </span>
                  ) : (
                    entitlements.features.map((f) => (
                      <span
                        key={f}
                        className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                      >
                        {PLAN_FEATURE_LABELS[f]}
                      </span>
                    ))
                  )}
                  {excludedFeatures.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400 line-through"
                    >
                      {PLAN_FEATURE_LABELS[f]}
                    </span>
                  ))}
                </div>
              </div>
              <Button variant="outline" onClick={() => setShowCatalog(true)}>
                Lihat paket
              </Button>
            </div>

            <p className="mt-5 text-[11px] text-slate-400">
              Berjalan sejak {date(data.monthStart)}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200 lg:grid-cols-4">
              <UsageCell
                label="Kredit AI"
                used={usage.creditsUsed}
                limit={entitlements.aiCreditsPerMonth}
                subs={[
                  { label: "Balasan AI", used: usage.replyCredits },
                  { label: "Modul skenario", used: usage.moduleCredits },
                ]}
              />
              <UsageCell
                label="MAU"
                used={usage.mau}
                limit={entitlements.mauLimit}
                note="MAU dihitung dari pengirim unik bulan ini"
              />
              <UsageCell label="Staf" used={usage.staff} limit={entitlements.staffLimit} />
              <UsageCell
                label="Saluran aktif"
                used={usage.channels}
                limit={entitlements.channelLimit}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">Tagihan</h2>
              <p className="text-xs text-slate-400">
                {data.invoices.length === 0
                  ? "Belum ada tagihan"
                  : `${data.invoices.length} invoice`}
              </p>
            </div>
            {data.invoices.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">
                Invoice muncul setelah admin menagihkan paket.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {sortedInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-800">
                        {periodDate(inv.periodStart)} - {periodDate(inv.periodEnd)}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400">{inv.number}</p>
                      {inv.status === "ISSUED" && (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Jatuh tempo {date(inv.dueAt)}
                        </p>
                      )}
                    </div>
                    <p className="font-mono text-[13px] tabular-nums text-slate-700">
                      {idr(inv.amountIdr)}
                    </p>
                    <InvoiceStatus status={inv.status} />
                    {inv.status === "ISSUED" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPayInvoice(inv)}
                      >
                        Cara bayar
                      </Button>
                    ) : (
                      <span className="w-[88px] text-right text-[11px] text-slate-400">
                        {inv.status === "PAID" && inv.paidAt
                          ? `Dibayar ${date(inv.paidAt)}`
                          : ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {payInvoice && (
        <Dialog
          open
          onClose={() => setPayInvoice(null)}
          ariaLabel="Cara bayar"
          className="max-w-md rounded-2xl border-slate-200 bg-white p-0 shadow-xl"
        >
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  {payInvoice.number}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Cara bayar</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {idr(payInvoice.amountIdr)} sebelum {date(payInvoice.dueAt)}
                </p>
              </div>
              <button
                onClick={() => setPayInvoice(null)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              {data?.bank ? (
                <dl className="space-y-3">
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Bank
                    </dt>
                    <dd className="text-sm font-medium text-slate-900">{data.bank.name}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Nomor rekening
                    </dt>
                    <dd className="font-mono text-sm font-medium text-slate-900">
                      {data.bank.accountNumber}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      Atas nama
                    </dt>
                    <dd className="text-sm font-medium text-slate-900">
                      {data.bank.accountHolder}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-slate-500">
                  Hubungi admin untuk instruksi pembayaran.
                </p>
              )}
              <p className="mt-4 text-[11px] text-slate-400">
                Admin menandai lunas setelah pembayaran diterima.
              </p>
            </div>
        </Dialog>
      )}

      {showCatalog && (
        <Dialog
          open
          onClose={() => setShowCatalog(false)}
          ariaLabel={requestPlan ? "Ajukan paket" : "Paket lain"}
          className="max-w-lg rounded-2xl border-slate-200 bg-white p-0 shadow-xl"
        >
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Paket
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  {requestPlan ? `Ajukan ${requestPlan.name}` : "Paket lain"}
                </h2>
                {requestPlan && (
                  <p className="mt-0.5 text-sm text-slate-500">
                    {idr(requestPlan.priceIdr)} / bulan. Admin akan menghubungi Anda.
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setRequestPlan(null);
                  setShowCatalog(false);
                }}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            {requestPlan ? (
              <div className="space-y-4 p-5">
                <div className="space-y-1.5">
                  <label htmlFor="plan-note" className="text-sm font-medium text-slate-700">
                    Catatan (opsional)
                  </label>
                  <Textarea
                    id="plan-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Kebutuhan Anda atau waktu yang diinginkan."
                    rows={3}
                  />
                </div>
                {formError && <p className="text-sm text-red-600">{formError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setRequestPlan(null)}>
                    Kembali
                  </Button>
                  <Button onClick={() => void submitRequest()} disabled={busy}>
                    {busy ? "Mengirim..." : "Kirim permintaan"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-5">
                {data?.openRequest ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    Permintaan {data.openRequest.requestedPlanName} sedang diproses.
                  </p>
                ) : data?.latestRequest ? (
                  <p
                    className={`rounded-lg px-3 py-2 text-[12px] ${
                      data.latestRequest.status === "REJECTED"
                        ? "bg-red-50 text-red-700"
                        : data.latestRequest.status === "DONE"
                          ? "bg-green-50 text-green-700"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    Permintaan terakhir {data.latestRequest.requestedPlanName}:{" "}
                    {data.latestRequest.status === "REJECTED"
                      ? "DITOLAK"
                      : data.latestRequest.status === "DONE"
                        ? "SELESAI"
                        : data.latestRequest.status}{" "}
                    pada {date(data.latestRequest.createdAt)}.
                  </p>
                ) : null}
                {otherPlans.length === 0 && (
                  <p className="text-sm text-slate-400">Belum ada paket lain.</p>
                )}
                {otherPlans.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{p.name}</p>
                      <p className="mt-0.5 text-sm text-slate-500">{idr(p.priceIdr)} / bulan</p>
                      <p className="mt-1 text-[11.5px] text-slate-400">
                        {limitLabel(p.aiCreditsPerMonth)} kredit, {limitLabel(p.mauLimit)} MAU,{" "}
                        {limitLabel(p.staffLimit)} staf, {limitLabel(p.channelLimit)} saluran
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-slate-400">
                        {p.features.length === 0
                          ? "Fitur core"
                          : PLAN_FEATURE_KEYS.filter((k) => p.features.includes(k))
                              .map((k) => PLAN_FEATURE_LABELS[k])
                              .join(", ")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!data?.openRequest}
                      onClick={() => {
                        setFormError(null);
                        setNote("");
                        setRequestPlan(p);
                      }}
                    >
                      Ajukan
                    </Button>
                  </div>
                ))}
              </div>
            )}
        </Dialog>
      )}
    </DashboardShell>
  );
}
