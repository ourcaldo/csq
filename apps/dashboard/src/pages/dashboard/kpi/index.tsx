// KPI page (PRD 17): OWNER-only. Redesign 2026-11-19 (docs/demo/
// kpi_csq_performance_targets.html): metric cards, live report card grid
// with SLA bars and history, management table with scope chips + status
// tabs, slide-over create/edit drawers. Wired to the existing
// /api/dashboard/kpi/report and /api/dashboard/kpi/targets routes.
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import {
  Buildings,
  CheckCircle,
  ChatCircleText,
  Lightning,
  ShoppingCart,
  SlidersHorizontal,
  Target,
  Trophy,
  User,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { KpiReportRow, KpiMetricName, KpiPeriodName } from "@csq/core/types/kpi";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { cn } from "@csq/ui/lib/utils";

type TeamMember = {
  id: string;
  email: string;
  name: string | null;
  role: "OWNER" | "STAFF";
};

type KpiTargetRow = {
  id: string;
  scope: "TENANT" | "USER";
  userId: string | null;
  userName: string | null;
  metric: KpiMetricName;
  period: KpiPeriodName;
  thresholdMinutes: number | null;
  targetValue: number;
  active: boolean;
};

const METRIC_LABELS: Record<KpiMetricName, string> = {
  ORDERS: "Pesanan dibuat",
  DEALS_WON: "Deal menang",
  FIRST_RESPONSE: "Respons chat",
  REPLIES: "Chat direspons",
};

const METRIC_ICONS: Record<KpiMetricName, typeof Target> = {
  ORDERS: ShoppingCart,
  DEALS_WON: Trophy,
  FIRST_RESPONSE: Lightning,
  REPLIES: ChatCircleText,
};

const PERIOD_LABELS: Record<KpiPeriodName, string> = {
  DAY: "per hari",
  WEEK: "per minggu",
  TWO_WEEK: "per 2 minggu",
  MONTH: "per bulan",
};

function periodKeyLabel(key: string): string {
  if (key.includes("-H")) return key.replace("-H1", " (awal bulan)").replace("-H2", " (akhir bulan)");
  if (key.includes("-W")) return `Pekan ${key.split("-W")[1]} ${key.split("-W")[0]}`;
  if (key.length === 7)
    return new Date(`${key}-02T00:00:00Z`).toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    });
  return key;
}

function daysLeft(endIso: string): number {
  const ms = new Date(endIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export default function KpiPage() {
  const { data: reportData, refresh: refreshReport } = useApi<{
    items: KpiReportRow[];
  }>("/api/dashboard/kpi/report");
  const { data: targetsData, refresh: refreshTargets } = useApi<{
    items: KpiTargetRow[];
  }>("/api/dashboard/kpi/targets");
  const { data: teamData } = useApi<{ items: TeamMember[] }>(
    "/api/dashboard/team?pageSize=100"
  );
  const members = teamData?.items ?? [];
  const targets = targetsData?.items ?? [];
  const report = reportData?.items ?? [];

  // View state
  const [staffFilter, setStaffFilter] = useState("");
  const [tableFilter, setTableFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  // Summary stats over the active report rows.
  const stats = (() => {
    const achieved = report.filter((k) =>
      k.metric === "FIRST_RESPONSE" ? k.current.actual >= 80 : k.current.achieved
    ).length;
    const avg =
      report.length > 0
        ? Math.round(
            report.reduce(
              (s, k) => s + (k.metric === "FIRST_RESPONSE" ? Math.round(k.current.actual) : k.current.progress),
              0
            ) / report.length
          )
        : 0;
    return { active: report.length, achieved, avg };
  })();

  const staffOptions = Array.from(
    new Map(
      report
        .filter((k) => k.scope === "USER" && k.userName)
        .map((k) => [k.userId as string, k.userName as string])
    ).entries()
  );
  const visibleReport = staffFilter ? report.filter((k) => k.userId === staffFilter) : report;
  const visibleTargets = targets.filter((t) =>
    tableFilter === "ACTIVE" ? t.active : tableFilter === "INACTIVE" ? !t.active : true
  );

  // ── Create drawer state ──
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // THREE apply-to modes (owner review 2026-11-10): tenant, one specific
  // member, or every member at once (allStaff batch).
  const [applyTo, setApplyTo] = useState<"TENANT" | "ONE_STAFF" | "ALL_STAFF">("TENANT");
  const [userId, setUserId] = useState("");
  const [metric, setMetric] = useState<KpiMetricName>("REPLIES");
  const [period, setPeriod] = useState<KpiPeriodName>("WEEK");
  const [targetValue, setTargetValue] = useState("");
  const [thresholdMinutes, setThresholdMinutes] = useState("");

  useEffect(() => {
    if (createOpen) {
      setCreateError(null);
      setApplyTo("TENANT");
      setUserId("");
      setMetric("REPLIES");
      setPeriod("WEEK");
      setTargetValue("");
      setThresholdMinutes("");
    }
  }, [createOpen]);

  const isMeasurement = metric === "FIRST_RESPONSE";
  const metricOptions =
    applyTo === "TENANT"
      ? (["ORDERS", "DEALS_WON", "FIRST_RESPONSE", "REPLIES"] as KpiMetricName[])
      : (["DEALS_WON", "FIRST_RESPONSE", "REPLIES"] as KpiMetricName[]);

  function onApplyTo(v: "TENANT" | "ONE_STAFF" | "ALL_STAFF") {
    setApplyTo(v);
    if (!metricOptions.includes(metric) && (v !== "TENANT" || metric === "ORDERS")) {
      setMetric("REPLIES");
    }
  }

  function refreshAll() {
    void refreshReport();
    void refreshTargets();
  }

  async function createKpi(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreateError(null);
    if (applyTo === "ONE_STAFF" && !userId) {
      setCreateError("Pilih anggota tim terlebih dahulu.");
      return;
    }
    if (isMeasurement && (!thresholdMinutes || Number(thresholdMinutes) < 1)) {
      setCreateError("Batas waktu respons minimal 1 menit.");
      return;
    }
    if (!isMeasurement && (!targetValue || Number(targetValue) < 1)) {
      setCreateError("Target jumlah minimal 1.");
      return;
    }
    setCreating(true);
    try {
      await apiSend("/api/dashboard/kpi/targets", "POST", {
        scope: applyTo === "TENANT" ? "TENANT" : "USER",
        ...(applyTo === "ONE_STAFF" ? { userId } : {}),
        ...(applyTo === "ALL_STAFF" ? { allStaff: true } : {}),
        metric,
        period,
        targetValue: isMeasurement ? 0 : Number(targetValue),
        ...(isMeasurement ? { thresholdMinutes: Number(thresholdMinutes) } : {}),
      });
      setCreateOpen(false);
      refreshAll();
      showToast("KPI baru berhasil ditambahkan");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Gagal membuat KPI.");
    } finally {
      setCreating(false);
    }
  }

  // ── Edit drawer state ──
  const [editTarget, setEditTarget] = useState<KpiTargetRow | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editThreshold, setEditThreshold] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function openEdit(t: KpiTargetRow) {
    setEditTarget(t);
    setEditValue(String(t.targetValue));
    setEditThreshold(t.thresholdMinutes !== null ? String(t.thresholdMinutes) : "");
    setEditError(null);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (editing || !editTarget) return;
    setEditError(null);
    if (editTarget.metric === "FIRST_RESPONSE" && (!editThreshold || Number(editThreshold) < 1)) {
      setEditError("Batas waktu respons minimal 1 menit.");
      return;
    }
    setEditing(true);
    try {
      await apiSend(`/api/dashboard/kpi/targets/${editTarget.id}`, "PATCH", {
        // FIRST_RESPONSE is measurement-only: only its SLA threshold is
        // editable, never a numeric target.
        ...(editTarget.metric !== "FIRST_RESPONSE" && editValue !== ""
          ? { targetValue: Number(editValue) }
          : {}),
        ...(editThreshold !== "" ? { thresholdMinutes: Number(editThreshold) } : {}),
      });
      setEditTarget(null);
      refreshAll();
      showToast("Perubahan KPI disimpan");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Gagal menyimpan KPI.");
    } finally {
      setEditing(false);
    }
  }

  async function toggleActive(t: KpiTargetRow) {
    try {
      await apiSend(`/api/dashboard/kpi/targets/${t.id}`, "PATCH", { active: !t.active });
      refreshAll();
      showToast(t.active ? "KPI dinonaktifkan" : "KPI diaktifkan");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Gagal memperbarui KPI.");
    }
  }

  return (
    <DashboardShell
      title="KPI & Target Kinerja"
      description="Pantau pencapaian target tim dan tenant yang dihitung otomatis dari aktivitas percakapan, pesanan, dan pipeline."
      actions={
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-green-700 active:scale-[0.99]"
        >
          <span className="text-sm font-bold leading-none">+</span>
          <span>KPI Baru</span>
        </button>
      }
    >
      {/* Summary metrics strip */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="KPI Aktif" value={String(stats.active)} icon={<Target size={16} className="text-slate-400" />} />
        <StatCard
          label="Target Tercapai Periode Ini"
          value={String(stats.achieved)}
          valueCls="text-green-700"
          icon={<span className="h-2 w-2 rounded-full bg-green-600" />}
        />
        <StatCard label="Rata-rata Progres Target" value={`${stats.avg}%`} />
      </div>

      {/* Laporan Periode Berjalan */}
      <section className="mb-6">
        <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <h2 className="text-sm font-semibold text-slate-900">Laporan Periode Berjalan</h2>
          {staffOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500">Filter tampilan:</label>
              <select
                value={staffFilter}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setStaffFilter(e.target.value)}
                aria-label="Filter staf"
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-slate-400 focus:outline-none"
              >
                <option value="">Semua KPI</option>
                {staffOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {report.length === 0 ? (
          <EmptyPanel
            title="Belum ada KPI aktif"
            text="Buat KPI pertama untuk mulai mengukur kinerja tim dan tenant secara otomatis."
            icon={<Target size={20} />}
          />
        ) : visibleReport.length === 0 ? (
          <EmptyPanel title="Tidak ada KPI" text="Staf ini belum memiliki KPI aktif." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visibleReport.map((k) => {
              const isResp = k.metric === "FIRST_RESPONSE";
              const meta = k.current.meta ?? {};
              const valueText = isResp ? `${k.current.actual.toFixed(0)}%` : String(Math.round(k.current.actual));
              const Icon = METRIC_ICONS[k.metric];
              return (
                <div
                  key={k.id}
                  className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300"
                >
                  <div className="mb-3.5 flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <Icon size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{METRIC_LABELS[k.metric]}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {k.scope === "TENANT" ? "Seluruh tenant" : (k.userName ?? "Staf")}
                          {" \u2022 "}
                          {isResp ? `respons < ${k.thresholdMinutes} menit` : PERIOD_LABELS[k.period]}
                        </p>
                      </div>
                    </div>
                    {isResp ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
                        Metrik SLA
                      </span>
                    ) : k.current.achieved ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                        Tercapai
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Berjalan
                      </span>
                    )}
                  </div>

                  {isResp ? (
                    <>
                      <div className="mb-3">
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">
                            {valueText}
                          </span>
                          <span className="text-xs font-medium text-slate-500">direspons tepat waktu</span>
                        </div>
                        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600 transition-all"
                            style={{ width: `${Math.min(100, Math.max(2, k.current.actual))}%` }}
                          />
                        </div>
                      </div>
                      <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {typeof meta.incomingChats === "number" ? (
                          <>
                            <strong className="font-semibold text-slate-800">
                              {String(meta.answeredChats ?? 0)} dari {String(meta.incomingChats)}
                            </strong>{" "}
                            chat direspons &lt; {k.thresholdMinutes} menit
                          </>
                        ) : (
                          "Belum ada chat masuk"
                        )}
                        {typeof meta.avgMinutes === "number" && (
                          <>
                            {" \u2022 "}rata-rata{" "}
                            <strong className="font-semibold text-slate-800">{String(meta.avgMinutes)} mnt</strong>
                          </>
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mb-2 flex items-baseline justify-between">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">
                            {valueText}
                          </span>
                          <span className="text-xs font-medium tabular-nums text-slate-400">/ {k.targetValue}</span>
                        </div>
                        <span
                          className={cn(
                            "font-mono text-xs font-semibold tabular-nums",
                            k.current.achieved ? "text-green-700" : "text-slate-600"
                          )}
                        >
                          {k.current.progress}%
                        </span>
                      </div>
                      <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            k.current.achieved ? "bg-green-600" : "bg-amber-500"
                          )}
                          style={{ width: `${Math.min(100, Math.max(2, k.current.progress))}%` }}
                        />
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      Sisa <strong className="font-medium text-slate-600">{daysLeft(k.current.end)} hari</strong> di
                      periode ini
                    </span>
                    <span className="font-mono">{k.current.key}</span>
                  </div>

                  {k.history.length > 0 && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Riwayat Periode
                      </p>
                      <ul className="space-y-1.5">
                        {k.history.slice(0, 6).map((h) => (
                          <li key={h.key} className="flex items-center justify-between text-xs">
                            <span className="text-slate-600">{periodKeyLabel(h.key)}</span>
                            <span className="flex items-center gap-1.5 font-mono tabular-nums">
                              <span className="font-medium text-slate-900">
                                {isResp ? `${h.actual.toFixed(0)}%` : `${h.actual} / ${h.target}`}
                              </span>
                              {!isResp &&
                                (h.achieved ? (
                                  <CheckCircle size={14} weight="fill" className="text-green-600" />
                                ) : (
                                  <XCircle size={14} weight="fill" className="text-red-400" />
                                ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Daftar Konfigurasi KPI */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-2 border-b border-slate-200 bg-slate-50/50 px-4 py-3.5 sm:flex-row sm:items-center">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <SlidersHorizontal size={15} className="text-slate-500" />
              <span>Daftar Konfigurasi KPI</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Maksimum 5 KPI aktif per tenant dan per anggota tim.</p>
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-200/60 p-0.5 text-xs font-medium">
            {(
              [
                ["ALL", "Semua"],
                ["ACTIVE", "Aktif"],
                ["INACTIVE", "Nonaktif"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTableFilter(k)}
                className={cn(
                  "rounded-md px-2.5 py-1",
                  tableFilter === k ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {visibleTargets.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-semibold text-slate-900">Belum ada KPI pada filter ini</p>
            <p className="mt-1 text-xs text-slate-500">
              Klik &quot;KPI Baru&quot; di pojok kanan atas untuk menambahkan target kinerja.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Metrik KPI</th>
                  <th className="px-4 py-3">Cakupan</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Periode</th>
                  <th className="px-4 py-3">Target / Batas</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleTargets.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium text-slate-900">{METRIC_LABELS[t.metric]}</td>
                    <td className="px-4 py-3">
                      {t.scope === "TENANT" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          <Buildings size={13} className="text-slate-500" /> Seluruh tenant
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          <User size={13} className="text-blue-600" /> {t.userName ?? "Staf"}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-slate-600 sm:table-cell">
                      {PERIOD_LABELS[t.period]}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-medium tabular-nums text-slate-700">
                      {t.metric === "FIRST_RESPONSE" ? `respons < ${t.thresholdMinutes} mnt` : String(t.targetValue)}
                    </td>
                    <td className="px-4 py-3">
                      {t.active ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                          Aktif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                          Nonaktif
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(t)}
                          disabled={!t.active}
                          aria-label="Ubah target"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void toggleActive(t)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                        >
                          {t.active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══ Create Drawer ═══ */}
      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Buat KPI Baru"
        subtitle="Maksimum 5 KPI aktif per tenant dan per anggota tim"
        maxWidth="max-w-md"
      >
        <form className="flex flex-1 flex-col overflow-hidden" onSubmit={createKpi}>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {createError && <FormError msg={createError} />}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Berlaku Untuk</label>
              <select
                value={applyTo}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  onApplyTo(e.target.value as "TENANT" | "ONE_STAFF" | "ALL_STAFF")
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
              >
                <option value="TENANT">Seluruh tenant (total tim)</option>
                <option value="ONE_STAFF">Staf tertentu</option>
                <option value="ALL_STAFF">Semua anggota tim (satu KPI per orang)</option>
              </select>
            </div>

            {applyTo === "ONE_STAFF" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Anggota Tim</label>
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                >
                  <option value="">- pilih anggota -</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.email}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Metrik Kinerja</label>
              <select
                value={metric}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setMetric(e.target.value as KpiMetricName)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
              >
                {metricOptions.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </option>
                ))}
              </select>
              {isMeasurement && (
                <p className="mt-1.5 rounded-lg bg-blue-50 p-2.5 text-xs text-blue-700">
                  Metrik pengukuran: persentase chat yang direspons tepat waktu dihitung otomatis - tidak
                  memerlukan target angka.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Periode Evaluasi</label>
              <select
                value={period}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPeriod(e.target.value as KpiPeriodName)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
              >
                <option value="DAY">Per hari</option>
                <option value="WEEK">Per minggu</option>
                <option value="TWO_WEEK">Per 2 minggu</option>
                <option value="MONTH">Per bulan</option>
              </select>
            </div>

            {isMeasurement ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Batas Waktu Respons (menit)
                </label>
                <input
                  type="number"
                  min={1}
                  value={thresholdMinutes}
                  onChange={(e) => setThresholdMinutes(e.target.value)}
                  placeholder="mis. 10"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Target Jumlah</label>
                <input
                  type="number"
                  min={1}
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  placeholder="mis. 20"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                />
              </div>
            )}
          </div>
          <DrawerFooter>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-green-700 disabled:opacity-50"
            >
              {creating ? "Menyimpan..." : "Simpan KPI"}
            </button>
          </DrawerFooter>
        </form>
      </Drawer>

      {/* ═══ Edit Drawer ═══ */}
      <Drawer
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Ubah Target KPI"
        subtitle={
          editTarget
            ? `${METRIC_LABELS[editTarget.metric]} \u2022 ${
                editTarget.scope === "TENANT" ? "Seluruh tenant" : (editTarget.userName ?? "Staf")
              }`
            : "Sesuaikan angka target periode berjalan"
        }
        maxWidth="max-w-md"
      >
        <form className="flex flex-1 flex-col overflow-hidden" onSubmit={saveEdit}>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {editError && <FormError msg={editError} />}
            {editTarget?.metric === "FIRST_RESPONSE" ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Batas Waktu Respons (menit)
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={editThreshold}
                  onChange={(e) => setEditThreshold(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Metrik pengukuran - tidak ada target angka; persentase dihitung otomatis.
                </p>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Target Jumlah</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                />
              </div>
            )}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              Periode sebelumnya yang sudah ditutup tidak ikut berubah - riwayat menyimpan target yang
              berlaku saat periode tersebut berjalan.
            </div>
          </div>
          <DrawerFooter>
            <button
              type="button"
              onClick={() => setEditTarget(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={editing}
              className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-green-700 disabled:opacity-50"
            >
              {editing ? "Menyimpan..." : "Simpan Perubahan"}
            </button>
          </DrawerFooter>
        </form>
      </Drawer>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg">
          <CheckCircle size={14} weight="fill" className="text-green-400" />
          {toast}
        </div>
      )}
    </DashboardShell>
  );
}

// ── Sub-components ──

function StatCard(props: {
  label: string;
  value: string;
  valueCls?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{props.label}</p>
        {props.icon}
      </div>
      <p className={cn("mt-1.5 text-2xl font-bold tabular-nums text-slate-900", props.valueCls)}>
        {props.value}
      </p>
    </div>
  );
}

function EmptyPanel(props: { title: string; text: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {props.icon ?? <Target size={20} />}
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900">{props.title}</p>
      <p className="mt-1 max-w-sm text-xs text-slate-500">{props.text}</p>
    </div>
  );
}

function FormError({ msg }: { msg: string }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600">
      {msg}
    </p>
  );
}

function Drawer(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/30"
      style={{ animation: "kpiFadeIn 0.15s ease-out" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <style>{`@keyframes kpiFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes kpiSlideIn { from { transform: translateX(24px) } to { transform: translateX(0) } }`}</style>
      <div
        className={cn(
          "flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-2xl",
          props.maxWidth ?? "max-w-md"
        )}
        style={{ animation: "kpiSlideIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{props.title}</h3>
            {props.subtitle && <p className="text-xs text-slate-500">{props.subtitle}</p>}
          </div>
          <button
            onClick={props.onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Tutup"
          >
            <X size={16} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function DrawerFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
      {children}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<
  Record<string, unknown>
>(async () => ({ props: {} }), { requiredRole: "OWNER" });
