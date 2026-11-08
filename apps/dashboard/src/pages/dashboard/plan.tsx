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

function limitLabel(v: number | null): string {
  return v === null ? "Tanpa batas" : num(v);
}

function Meter({
  label,
  used,
  limit,
  note,
}: {
  label: string;
  used: number;
  limit: number | null;
  note: string;
}) {
  const pct = limit === null ? null : Math.min(100, Math.round((used / limit) * 100));
  const tone =
    pct === null ? "" : pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-green-600";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">{label}</p>
        <p className="font-mono text-xs tabular-nums text-slate-500">
          {num(used)}
          {limit === null ? "" : ` / ${num(limit)}`}
        </p>
      </div>
      {pct === null ? (
        <p className="mt-1 text-[11px] text-slate-400">Tanpa batas</p>
      ) : (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="mt-1 text-[11px] text-slate-400">{note}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
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
  const [requestPlan, setRequestPlan] = useState<Plan | null>(null);
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
  const unpaid = data?.invoices.find((i) => i.status === "ISSUED") ?? null;
  const otherPlans = (data?.plans ?? []).filter((p) => p.name !== planName);

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
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Paket aktif
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {planName ?? "Tanpa paket"}
              </p>
              {planName ? (
                <p className="text-sm text-slate-500">
                  {currentPrice !== null ? `${idr(currentPrice)} / bulan` : "Harga manual"}
                </p>
              ) : (
                <p className="text-sm text-slate-500">
                  Semua fitur aktif, tanpa batas. Paket belum ditetapkan.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-1.5">
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
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Pemakaian bulan ini
                </p>
                <p className="text-xs text-slate-400">Sejak {date(data.monthStart)}</p>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Meter
                  label="Kredit AI"
                  used={usage.creditsUsed}
                  limit={entitlements.aiCreditsPerMonth}
                  note={`${num(usage.agentReplies)} balasan AI, ${num(usage.scenarioCredits)} modul skenario`}
                />
                <Meter
                  label="MAU"
                  used={usage.mau}
                  limit={entitlements.mauLimit}
                  note="Pengirim unik yang menghubungi bulan ini"
                />
                <Meter
                  label="Staf"
                  used={usage.staff}
                  limit={entitlements.staffLimit}
                  note="Tidak termasuk owner"
                />
                <Meter
                  label="Saluran aktif"
                  used={usage.channels}
                  limit={entitlements.channelLimit}
                  note="Hanya saluran yang terhubung"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">Tagihan</h2>
              <p className="text-xs text-slate-400">
                Jatuh tempo {data.dueDays} hari, tenggang {data.graceDays} hari
              </p>
            </div>
            {data.invoices.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                Belum ada tagihan. Invoice muncul setelah paket ditagihkan admin.
              </p>
            ) : (
              <>
                {unpaid && (
                  <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">
                      {unpaid.number} menunggu pembayaran
                    </p>
                    <p className="mt-0.5 text-sm text-amber-800">
                      {idr(unpaid.amountIdr)} sebelum {date(unpaid.dueAt)}
                    </p>
                    {data.bank ? (
                      <dl className="mt-2 grid grid-cols-1 gap-0.5 text-sm text-amber-900 sm:grid-cols-3">
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-amber-700">Bank</dt>
                          <dd className="font-medium">{data.bank.name}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-amber-700">No. rekening</dt>
                          <dd className="font-mono font-medium">{data.bank.accountNumber}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-amber-700">Atas nama</dt>
                          <dd className="font-medium">{data.bank.accountHolder}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-1 text-sm text-amber-800">
                        Hubungi admin untuk instruksi pembayaran.
                      </p>
                    )}
                  </div>
                )}
                <div className="overflow-x-auto px-5 py-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-4">Invoice</th>
                        <th className="py-2 pr-4">Periode</th>
                        <th className="py-2 pr-4 text-right">Jumlah</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2">Jatuh tempo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.invoices.map((inv) => (
                        <tr key={inv.id} className="border-b border-slate-50 last:border-0">
                          <td className="py-2.5 pr-4 font-mono text-[12px]">{inv.number}</td>
                          <td className="py-2.5 pr-4 text-[12.5px] text-slate-600">
                            {date(inv.periodStart)} - {date(inv.periodEnd)}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                            {idr(inv.amountIdr)}
                          </td>
                          <td className="py-2.5 pr-4">
                            <StatusBadge status={inv.status} />
                          </td>
                          <td className="py-2.5 text-[12.5px] text-slate-500">
                            {inv.status === "PAID" && inv.paidAt
                              ? `Dibayar ${date(inv.paidAt)}`
                              : date(inv.dueAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">Paket lain</h2>
              {data.openRequest && (
                <p className="text-xs text-amber-700">
                  Permintaan {data.openRequest.requestedPlanName} sedang diproses
                </p>
              )}
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {otherPlans.length === 0 && (
                <p className="text-sm text-slate-400">Belum ada paket lain.</p>
              )}
              {otherPlans.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="text-sm font-medium text-slate-700">{idr(p.priceIdr)}</p>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-500">
                    {limitLabel(p.aiCreditsPerMonth)} kredit, {limitLabel(p.mauLimit)} MAU,{" "}
                    {limitLabel(p.staffLimit)} staf, {limitLabel(p.channelLimit)} saluran
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {p.features.length === 0
                      ? "Fitur core"
                      : PLAN_FEATURE_KEYS.filter((k) => p.features.includes(k))
                          .map((k) => PLAN_FEATURE_LABELS[k])
                          .join(", ")}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 w-full"
                    disabled={!!data.openRequest}
                    onClick={() => {
                      setFormError(null);
                      setNote("");
                      setRequestPlan(p);
                    }}
                  >
                    Ajukan paket
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {requestPlan && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-20"
          onClick={() => setRequestPlan(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Paket
                </p>
                <h2 className="text-lg font-semibold text-slate-900">
                  Ajukan {requestPlan.name}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {idr(requestPlan.priceIdr)} / bulan. Admin akan menghubungi Anda.
                </p>
              </div>
              <button
                onClick={() => setRequestPlan(null)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>
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
                  Batal
                </Button>
                <Button onClick={() => void submitRequest()} disabled={busy}>
                  {busy ? "Mengirim..." : "Kirim permintaan"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
