// KPI page (PRD 17): OWNER-only. Two sections - the live report (current
// period per active KPI + the closed-period history) and target management
// (create / edit target / deactivate). Metrics measure recorded work only:
// orders, WON-stage moves, human replies, and human response latency.
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { Target as TargetIcon, Plus, PencilSimple, Check, X } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { KpiReportRow, KpiMetricName, KpiPeriodName } from "@csq/core/types/kpi";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Select } from "@csq/ui/components/ui/select";
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

const PERIOD_LABELS: Record<KpiPeriodName, string> = {
  DAY: "per hari",
  WEEK: "per minggu",
  TWO_WEEK: "per 2 minggu",
  MONTH: "per bulan",
};

function periodKeyLabel(key: string): string {
  if (key.includes("-H")) return key.replace("-H1", " (awal bulan)").replace("-H2", " (akhir bulan)");
  if (key.includes("-W")) return `Pekan ${key.split("-W")[1]} ${key.split("-W")[0]}`;
  if (key.length === 7) return new Date(`${key}-02T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
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
  // Report filter: all KPIs or one staff member's.
  const [staffFilter, setStaffFilter] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editThreshold, setEditThreshold] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // Reset the create form whenever the dialog reopens.
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

  function refreshAll() {
    void refreshReport();
    void refreshTargets();
  }

  const visibleReport = staffFilter
    ? report.filter((k) => k.userId === staffFilter)
    : report;
  const staffOptions = Array.from(
    new Map(
      report
        .filter((k) => k.scope === "USER" && k.userName)
        .map((k) => [k.userId as string, k.userName as string])
    ).entries()
  );

  async function createKpi(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      await apiSend("/api/dashboard/kpi/targets", "POST", {
        scope: applyTo === "TENANT" ? "TENANT" : "USER",
        ...(applyTo === "ONE_STAFF" ? { userId } : {}),
        ...(applyTo === "ALL_STAFF" ? { allStaff: true } : {}),
        metric,
        period,
        targetValue: Number(targetValue),
        ...(metric === "FIRST_RESPONSE"
          ? { thresholdMinutes: Number(thresholdMinutes) || null }
          : {}),
      });
      setCreateOpen(false);
      refreshAll();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Gagal membuat KPI.");
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (editing || !editId) return;
    setEditing(true);
    setEditError(null);
    try {
      const t = targets.find((x) => x.id === editId);
      await apiSend(`/api/dashboard/kpi/targets/${editId}`, "PATCH", {
        // FIRST_RESPONSE is measurement-only: only its SLA threshold is
        // editable, never a numeric target.
        ...(editValue !== "" && t && t.metric !== "FIRST_RESPONSE"
          ? { targetValue: Number(editValue) }
          : {}),
        ...(editThreshold !== "" ? { thresholdMinutes: Number(editThreshold) } : {}),
      });
      setEditId(null);
      refreshAll();
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
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Gagal memperbarui KPI.");
    }
  }

  function openEdit(t: KpiTargetRow) {
    setEditId(t.id);
    setEditValue(String(t.targetValue));
    setEditThreshold(t.thresholdMinutes !== null ? String(t.thresholdMinutes) : "");
    setEditError(null);
  }

  const isMeasurement = metric === "FIRST_RESPONSE";
  const metricOptions = (applyTo === "TENANT" ? (["ORDERS", "DEALS_WON", "FIRST_RESPONSE", "REPLIES"] as KpiMetricName[]) : (["DEALS_WON", "FIRST_RESPONSE", "REPLIES"] as KpiMetricName[]));

  return (
    <DashboardShell
      title="KPI"
      description="Target kinerja untuk tim dan tenant. Dihitung dari data percakapan, pesanan, dan pipeline."
      actions={
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
        >
          <Plus size={16} /> KPI Baru
        </button>
      }
    >
      <div className="space-y-6">
        {/* Report */}
        {report.length === 0 ? (
          <EmptyState
            title="Belum ada KPI"
            description="Buat KPI pertama untuk mulai mengukur kinerja tim dan tenant."
          />
        ) : (
          <>
            {staffOptions.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-500">Tampilkan</label>
                <Select
                  value={staffFilter}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setStaffFilter(e.target.value)}
                  className="h-8 w-auto text-xs"
                  aria-label="Filter staf"
                >
                  <option value="">Semua KPI</option>
                  {staffOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {visibleReport.length === 0 ? (
              <EmptyState title="Tidak ada KPI" description="Staf ini belum memiliki KPI aktif." />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {visibleReport.map((k) => {
                  const isResp = k.metric === "FIRST_RESPONSE";
                  const meta = k.current.meta ?? {};
                  const valueText = isResp
                    ? `${k.current.actual.toFixed(0)}%`
                    : String(Math.round(k.current.actual));
                  return (
                    <div key={k.id} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {METRIC_LABELS[k.metric]}
                          </p>
                          <p className="text-xs text-slate-500">
                            {k.scope === "TENANT" ? "Seluruh tenant" : (k.userName ?? "Staf")}
                            {" - "}
                            {isResp
                              ? `respons < ${k.thresholdMinutes} menit`
                              : PERIOD_LABELS[k.period]}
                          </p>
                        </div>
                        {!isResp && (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              k.current.achieved
                                ? "bg-green-50 text-green-700"
                                : "bg-amber-50 text-amber-700"
                            )}
                          >
                            {k.current.achieved ? "Tercapai" : "Berjalan"}
                          </span>
                        )}
                      </div>
                      {isResp ? (
                        <div className="mb-2">
                          <span className="text-2xl font-bold text-slate-900">{valueText}</span>
                          <p className="text-xs text-slate-500">
                            chat masuk yang direspons tepat waktu
                          </p>
                        </div>
                      ) : (
                        <div className="mb-2 flex items-baseline justify-between">
                          <span className="text-2xl font-bold text-slate-900">{valueText}</span>
                          <span className="text-xs text-slate-500">
                            Target: {k.targetValue} {PERIOD_LABELS[k.period]}
                          </span>
                        </div>
                      )}
                      {isResp ? (
                        <p className="mb-2 text-xs text-slate-400">
                          {typeof meta.incomingChats === "number"
                            ? `${meta.answeredChats ?? 0} dari ${meta.incomingChats} chat direspons < ${k.thresholdMinutes} menit`
                            : "Belum ada chat masuk"}
                          {typeof meta.avgMinutes === "number"
                            ? ` - rata-rata ${meta.avgMinutes} menit`
                            : ""}
                        </p>
                      ) : (
                        <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              k.current.achieved ? "bg-green-500" : "bg-amber-500"
                            )}
                            style={{ width: `${Math.max(2, k.current.progress)}%` }}
                          />
                        </div>
                      )}
                      <p className="mb-3 text-xs text-slate-400">
                        Sisa {daysLeft(k.current.end)} hari di periode ini ({k.current.key})
                      </p>
                      {k.history.length > 0 && (
                        <div className="border-t border-slate-100 pt-2">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Riwayat
                          </p>
                          <ul className="space-y-1">
                            {k.history.slice(0, 6).map((h) => (
                              <li key={h.key} className="flex items-center justify-between text-xs">
                                <span className="text-slate-600">{periodKeyLabel(h.key)}</span>
                                <span className="flex items-center gap-1.5">
                                  <span className="text-slate-900">
                                    {isResp
                                      ? `${h.actual.toFixed(0)}%`
                                      : `${h.actual} / ${h.target}`}
                                  </span>
                                  {!isResp &&
                                    (h.achieved ? (
                                      <Check size={13} weight="bold" className="text-green-600" />
                                    ) : (
                                      <X size={13} weight="bold" className="text-red-500" />
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
          </>
        )}

        {/* Management */}
        <div>
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <TargetIcon size={16} /> Kelola KPI
          </h2>
          {targets.length === 0 ? (
            <p className="text-sm text-slate-400">Belum ada KPI yang dibuat.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-2 font-medium">KPI</th>
                    <th className="px-4 py-2 font-medium">Cakupan</th>
                    <th className="px-4 py-2 font-medium">Periode</th>
                    <th className="px-4 py-2 font-medium">Target</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.id} className="border-b border-slate-50">
                      <td className="px-4 py-2.5">{METRIC_LABELS[t.metric]}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {t.scope === "TENANT" ? "Seluruh tenant" : (t.userName ?? "Staf")}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{PERIOD_LABELS[t.period]}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {t.metric === "FIRST_RESPONSE"
                          ? `respons < ${t.thresholdMinutes} menit`
                          : `${t.targetValue}`}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            t.active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                          )}
                        >
                          {t.active ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => openEdit(t)}
                            disabled={!t.active}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:opacity-40"
                            aria-label="Ubah target"
                          >
                            <PencilSimple size={16} />
                          </button>
                          <button
                            onClick={() => toggleActive(t)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
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
        </div>
      </div>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="KPI Baru"
        description="Maksimum 5 KPI aktif per tenant dan per anggota tim."
      >
        <form onSubmit={createKpi} className="space-y-3">
          {createError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {createError}
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Berlaku untuk</label>
            <Select value={applyTo} onChange={(e: ChangeEvent<HTMLSelectElement>) => setApplyTo(e.target.value as "TENANT" | "ONE_STAFF" | "ALL_STAFF")}>
              <option value="TENANT">Seluruh tenant (total tim)</option>
              <option value="ONE_STAFF">Staf tertentu</option>
              <option value="ALL_STAFF">Semua anggota tim (satu KPI per orang)</option>
            </Select>
          </div>
          {applyTo === "ONE_STAFF" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Anggota tim</label>
              <Select value={userId} onChange={(e: ChangeEvent<HTMLSelectElement>) => setUserId(e.target.value)}>
                <option value="">- pilih anggota -</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ?? m.email}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Metrik</label>
            <Select
              value={metric}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setMetric(e.target.value as KpiMetricName)}
            >
              {metricOptions.map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABELS[m]}
                </option>
              ))}
            </Select>
            {isMeasurement && (
              <p className="mt-1 text-xs text-slate-400">
                Metrik pengukuran: persentase chat yang direspons tepat waktu dihitung otomatis -
                tidak ada target angka.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Periode</label>
            <Select value={period} onChange={(e: ChangeEvent<HTMLSelectElement>) => setPeriod(e.target.value as KpiPeriodName)}>
              <option value="DAY">Per hari</option>
              <option value="WEEK">Per minggu</option>
              <option value="TWO_WEEK">Per 2 minggu</option>
              <option value="MONTH">Per bulan</option>
            </Select>
          </div>
          {isMeasurement ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Batas waktu respons (menit)
              </label>
              <input
                type="number"
                min={1}
                required
                value={thresholdMinutes}
                onChange={(e) => setThresholdMinutes(e.target.value)}
                placeholder="misal 10"
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Target jumlah</label>
              <input
                type="number"
                min={1}
                required
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="misal 20"
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {creating ? "Menyimpan…" : "Simpan KPI"}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editId !== null} onClose={() => setEditId(null)} title="Ubah KPI">
        <form onSubmit={saveEdit} className="space-y-3">
          {editError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {editError}
            </p>
          )}
          {editThreshold !== "" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Batas waktu respons (menit)
              </label>
              <input
                type="number"
                min={1}
                required
                value={editThreshold}
                onChange={(e) => setEditThreshold(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
              <p className="mt-1 text-xs text-slate-400">
                Metrik pengukuran - tidak ada target angka; persentase dihitung otomatis.
              </p>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Target jumlah</label>
              <input
                type="number"
                min={0}
                required
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>
          )}
          <p className="text-xs text-slate-400">
            Periode terakhir yang sudah tutup tidak berubah - riwayat menyimpan target saat
            periode itu berjalan.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditId(null)}
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={editing}
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {editing ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </form>
      </Dialog>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<
  Record<string, unknown>
>(async () => ({ props: {} }), { requiredRole: "OWNER" });
