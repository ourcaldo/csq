// /dashboard/pengaturan/paket - Paket & Kuota (reference: docs/demo/
// paket_kuota_csq_enterprise_split_pane_ledger.html). Split pane: left =
// usage ledger + invoices tab; right = subscription/billing rail.
// All wired to the existing /api/dashboard/billing API.
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { ArrowsOutSimple, CheckCircle, LockSimple, PlusCircle, Receipt, X } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { ReadOnlyBanner, useCanEdit } from "@/components/dashboard/settings/settings-access";
import { cn } from "@csq/ui/lib/utils";

type BillingData = {
  entitlements: {
    planName: string | null;
    aiCreditsPerMonth: number | null;
    mauLimit: number | null;
    staffLimit: number | null;
    channelLimit: number | null;
    features: string[];
  };
  usage: {
    aiCreditsUsed: number;
    mauCount: number;
    staffCount: number;
    channelCount: number;
  };
  monthStart: string;
  invoices: {
    id: string;
    number: string;
    planName: string;
    periodStart: string;
    periodEnd: string;
    amountIdr: number;
    status: string;
    dueAt: string;
    paidAt: string | null;
    method: string | null;
    reference: string | null;
  }[];
  plans: {
    id: string;
    name: string;
    priceIdr: number;
    aiCreditsPerMonth: number;
    mauLimit: number;
    staffLimit: number;
    channelLimit: number;
    features: string[];
  }[];
  openRequest: { id: string; requestedPlanName: string; status: string } | null;
  bank: { name: string; accountNumber: string; accountHolder: string } | null;
  dueDays: number;
  graceDays: number;
};

function idr(n: number): string {
  return "Rp " + n.toLocaleString("id-ID");
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function pct(used: number, limit: number | null): number {
  if (limit === null || limit === 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

const MODULE_LABELS: Record<string, string> = {
  campaigns: "Kampanye Broadcast",
  scenarios: "Skenario Otomasi",
  pipeline: "Manajemen Pipeline",
  email: "Modul Email",
  tickets: "Tiket Dukungan",
};

export default function PengaturanPaketPage() {
  // Owner decision 2026-11-26: usage, plan and invoice info is readable by
  // every member; submitting a plan-change request stays owner-gated.
  const canRequestPlan = useCanEdit("billing.lihat");
  const { data: session } = useSession();
  const { data, loading, error, refresh } = useApi<BillingData>("/api/dashboard/billing");

  const [tab, setTab] = useState<"usage" | "invoices">("usage");
  const [compareOpen, setCompareOpen] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const [requesting, setRequesting] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  const monthEnd = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }, []);
  const daysLeft = Math.max(
    0,
    Math.ceil((monthEnd.getTime() - Date.now()) / 86_400_000)
  );

  async function requestPlan(planId: string, planName: string, e?: FormEvent) {
    e?.preventDefault();
    if (requesting) return;
    setRequesting(planId);
    setFormError(null);
    try {
      await apiSend("/api/dashboard/billing", "POST", {
        planId,
        ...(requestNote.trim() ? { note: requestNote.trim() } : {}),
      });
      setCompareOpen(false);
      setRequestNote("");
      showToast(`Pengajuan upgrade ke ${planName} terkirim.`);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengirim pengajuan.");
    } finally {
      setRequesting(null);
    }
  }

  const currentPlanName = data?.entitlements.planName ?? "Legacy";
  const activeInvoices = data?.invoices ?? [];

  const ledgerRows = [
    {
      key: "credits",
      name: "Kredit AI",
      desc: "Inferensi model & automasi",
      used: data?.usage.aiCreditsUsed ?? 0,
      limit: data?.entitlements.aiCreditsPerMonth ?? null,
      detail: <>Balasan AI: <strong className="text-slate-900">{data?.usage.aiCreditsUsed ?? 0}</strong></>,
    },
    {
      key: "mau",
      name: "Monthly Active Users",
      desc: "Pengirim unik bulan ini",
      used: data?.usage.mauCount ?? 0,
      limit: data?.entitlements.mauLimit ?? null,
      detail: <>Nomor kontak unik</>,
    },
    {
      key: "staff",
      name: "Kursi Anggota Tim",
      desc: "Operator dashboard aktif",
      used: data?.usage.staffCount ?? 0,
      limit: data?.entitlements.staffLimit ?? null,
      detail: null,
    },
    {
      key: "channels",
      name: "Saluran Terhubung",
      desc: "WhatsApp Cloud API / Baileys",
      used: data?.usage.channelCount ?? 0,
      limit: data?.entitlements.channelLimit ?? null,
      detail: null,
    },
  ];

  return (
    <SettingsShell
      section="paket"
      title="Paket & Kuota"
      description="Pantau laju konsumsi harian, alokasi kapasitas paket, dan kelola perpanjangan langganan."
      headerExtra={
        <button
          type="button"
          onClick={() => setCompareOpen((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
        >
          <ArrowsOutSimple size={14} />
          <span>Bandingkan & Upgrade Paket</span>
        </button>
      }
    >
      {!canRequestPlan && <ReadOnlyBanner />}
      {/* Plan comparison drawer */}
      {compareOpen && (
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
                Katalog Paket Langganan CSQ
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Perubahan paket diproses oleh admin platform setelah pengajuan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompareOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
              aria-label="Tutup perbandingan paket"
            >
              <X size={16} />
            </button>
          </div>
          {formError && <p className="mb-3 text-xs font-medium text-red-600">{formError}</p>}
          <div className="overflow-x-auto border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Spesifikasi Kuota</th>
                  {(data?.plans ?? []).map((p) => (
                    <th key={p.id} className="px-4 py-2.5">
                      {p.name}
                      {p.name === currentPlanName && (
                        <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 font-mono text-[10px] text-green-800">
                          Saat Ini
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                <tr>
                  <td className="px-4 py-2.5 font-medium text-slate-900">Biaya Langganan / Bulan</td>
                  {(data?.plans ?? []).map((p) => (
                    <td key={p.id} className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                      {idr(p.priceIdr)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-medium text-slate-900">Kredit AI / Bulan</td>
                  {(data?.plans ?? []).map((p) => (
                    <td key={p.id} className="px-4 py-2.5 font-mono">
                      {p.aiCreditsPerMonth.toLocaleString("id-ID")} kredit
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-medium text-slate-900">Monthly Active Users (MAU)</td>
                  {(data?.plans ?? []).map((p) => (
                    <td key={p.id} className="px-4 py-2.5 font-mono">
                      {p.mauLimit?.toLocaleString("id-ID") ?? "Unlimited"} kontak
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-medium text-slate-900">Kursi Staf & Saluran WA</td>
                  {(data?.plans ?? []).map((p) => (
                    <td key={p.id} className="px-4 py-2.5 font-mono">
                      {p.staffLimit ?? "Unlimited"} staf / {p.channelLimit ?? "Unlimited"} saluran
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-4 py-2.5 font-medium text-slate-900">Aksi</td>
                  {(data?.plans ?? []).map((p) => (
                    <td key={p.id} className="px-4 py-2.5">
                      {p.name === currentPlanName ? (
                        <span className="font-mono text-[11px] text-slate-400">Paket Aktif</span>
                      ) : data?.openRequest ? (
                        <span className="font-mono text-[11px] text-amber-600">
                          Menunggu: {data.openRequest.requestedPlanName}
                        </span>
                      ) : canRequestPlan ? (
                        <button
                          type="button"
                          onClick={() => void requestPlan(p.id, p.name)}
                          disabled={requesting !== null}
                          className="rounded bg-green-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {requesting === p.id ? "Mengirim..." : "Ajukan Upgrade"}
                        </button>
                      ) : (
                        <span className="font-mono text-[11px] text-slate-400">Hanya pemilik</span>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Split pane */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        {/* LEFT: usage ledger + invoices */}
        <div className="py-6 lg:col-span-8 lg:pr-8">
          <div className="flex items-center justify-between border-b border-slate-200">
            <div className="flex gap-6">
              {(
                [
                  ["usage", "Konsumsi & Kuota"],
                  ["invoices", "Riwayat Tagihan"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={cn(
                    "relative pb-2.5 text-xs transition-colors",
                    tab === k ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-900"
                  )}
                >
                  {l}
                  {k === "invoices" && (
                    <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      {activeInvoices.length}
                    </span>
                  )}
                  {tab === k && <span className="absolute inset-x-0 bottom-[-1px] h-0.5 bg-green-600" />}
                </button>
              ))}
            </div>
            <span className="hidden font-mono text-[11px] text-slate-400 sm:inline">
              Periode: {data ? fmtDate(data.monthStart) : "-"} - {fmtDate(monthEnd.toISOString())}
            </span>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {loading && <p className="mt-4 text-sm text-slate-500">Memuat penggunaan...</p>}

          {!loading && tab === "usage" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 pr-4">Metrik Sumber Daya</th>
                    <th className="px-3 py-3">Konsumsi / Batas</th>
                    <th className="w-40 px-3 py-3">Utilisasi</th>
                    <th className="py-3 pl-3 text-right">Rincian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                  {ledgerRows.map((row) => {
                    const p = pct(row.used, row.limit);
                    return (
                      <tr key={row.key} className="hover:bg-slate-50/70">
                        <td className="py-4 pr-4">
                          <p className="text-xs font-semibold text-slate-900">{row.name}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{row.desc}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 font-mono text-xs">
                          <span className="font-semibold text-slate-900">{row.used}</span>
                          <span className="text-slate-400">
                            {" "}
                            / {row.limit === null ? "Unlimited" : row.limit.toLocaleString("id-ID")}
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  p >= 80 ? "bg-amber-500" : "bg-green-600"
                                )}
                                style={{ width: `${Math.max(2, p)}%` }}
                              />
                            </div>
                            <span className="w-9 text-right font-mono text-[11px] text-slate-600">
                              {row.limit === null ? "-" : `${p}%`}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 pl-3 text-right text-[11px] text-slate-500">
                          {row.detail ??
                            (row.limit !== null ? (
                              <>
                                Sisa <strong className="font-mono text-slate-800">
                                  {Math.max(0, row.limit - row.used)}
                                </strong>{" "}
                                {row.key === "channels" ? "saluran" : "slot"}
                              </>
                            ) : null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && tab === "invoices" && (
            <div className="pt-4">
              {activeInvoices.length === 0 ? (
                <div className="border-b border-slate-200 py-14 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400">
                    <Receipt size={18} />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-900">Belum ada tagihan diterbitkan</p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                    Invoice akan muncul otomatis setelah admin memproses penagihan paket{" "}
                    <strong className="font-medium text-slate-700">{currentPlanName}</strong>.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <th className="py-3 pr-4">Nomor</th>
                        <th className="px-4 py-3">Paket</th>
                        <th className="px-4 py-3">Periode</th>
                        <th className="px-4 py-3">Jumlah</th>
                        <th className="py-3 pl-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                      {activeInvoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-50/70">
                          <td className="py-3 pr-4 font-mono text-xs font-medium text-slate-900">{inv.number}</td>
                          <td className="px-4 py-3 text-xs text-slate-600">{inv.planName}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">
                            {fmtDate(inv.periodStart)} - {fmtDate(inv.periodEnd)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                            {idr(inv.amountIdr)}
                          </td>
                          <td className="py-3 pl-4 text-right">
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                                inv.status === "PAID"
                                  ? "bg-green-50 text-green-700"
                                  : inv.status === "OVERDUE"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-amber-50 text-amber-700"
                              )}
                            >
                              {inv.status === "PAID" ? "Lunas" : inv.status === "OVERDUE" ? "Jatuh Tempo" : "Tertunda"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: subscription rail */}
        <aside className="divide-y divide-slate-200 py-6 lg:col-span-4 lg:pl-8">
          <div className="pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Langganan Saat Ini
            </p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-slate-900">{currentPlanName}</span>
              {(data?.plans ?? []).find((p) => p.name === currentPlanName) && (
                <span className="font-mono text-sm font-semibold text-slate-900">
                  {idr((data?.plans ?? []).find((p) => p.name === currentPlanName)!.priceIdr)}
                  <span className="text-xs font-normal text-slate-400">/bln</span>
                </span>
              )}
            </div>
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Reset Kuota</span>
                <span className="font-mono font-medium text-slate-900">{fmtDate(monthEnd.toISOString())}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Sisa Siklus</span>
                <span className="font-mono font-medium text-slate-900">{daysLeft} hari</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Penagihan</span>
                <span className="font-medium text-slate-900">Invoice Admin (Net-{data?.dueDays ?? 7})</span>
              </div>
            </div>
          </div>

          <div className="py-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Hak Akses Modul
            </p>
            <ul className="mt-3 space-y-2.5 text-xs">
              {(data?.entitlements.features ?? []).map((f) => (
                <li key={f} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium text-slate-800">
                    <CheckCircle size={14} weight="fill" className="text-green-600" />
                    {MODULE_LABELS[f] ?? f}
                  </span>
                  <span className="font-mono text-[11px] text-green-700">Termasuk</span>
                </li>
              ))}
              {["Multi-Workspace & SSO"].map((m) => (
                <li key={m} className="flex items-center justify-between text-slate-400">
                  <span className="flex items-center gap-2">
                    <LockSimple size={14} />
                    {m}
                  </span>
                  <span className="font-mono text-[10px]">Enterprise</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Kontak Penagihan
            </p>
            <p className="mt-1.5 font-mono text-xs text-slate-800">
              {session?.user?.email ?? "-"}
            </p>
            {data?.openRequest ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
                Pengajuan <strong>{data.openRequest.requestedPlanName}</strong> sedang diproses admin
                (status: {data.openRequest.status}).
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setCompareOpen(true)}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <PlusCircle size={14} className="text-green-600" />
                Ajukan Upgrade Paket
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-md bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg">
          <CheckCircle size={14} weight="fill" className="text-green-400" />
          {toast}
        </div>
      )}
    </SettingsShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(
  async () => ({ props: {} })
);
