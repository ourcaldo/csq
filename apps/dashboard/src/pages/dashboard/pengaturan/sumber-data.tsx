// /dashboard/pengaturan/sumber-data - data source priority (drag + arrows),
// the reference's section 2. Same API as the old page; new presentation:
// a table with sync-mechanism and status columns, unsaved-changes pill,
// reset + save footer.
import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { ArrowDown, ArrowUp, DotsSixVertical } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { cn } from "@csq/ui/lib/utils";

type SourceType = "MANUAL" | "EXCEL" | "GOOGLE_SHEETS";

const TYPE_LABEL: Record<SourceType, string> = {
  MANUAL: "Database Entri Manual",
  EXCEL: "Excel / CSV Upload",
  GOOGLE_SHEETS: "Google Sheets OAuth",
};

const TYPE_SYNC: Record<SourceType, string> = {
  MANUAL: "Real-time via Dashboard Produk & Inventaris",
  EXCEL: "Parsing file terjadwal / unggah manual",
  GOOGLE_SHEETS: "Sinkronisasi otomatis setiap 15 menit",
};

function isSourceType(value: string): value is SourceType {
  return value === "MANUAL" || value === "EXCEL" || value === "GOOGLE_SHEETS";
}

export default function PengaturanSumberDataPage() {
  const { data, loading, error, refresh } = useApi<{ sourcePriority: string[] }>(
    "/api/dashboard/sources/priority"
  );

  const [order, setOrder] = useState<SourceType[]>([]);
  const [baseline, setBaseline] = useState<SourceType[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    const next: SourceType[] = [];
    for (const v of data.sourcePriority) {
      if (isSourceType(v)) next.push(v);
    }
    setOrder(next);
    setBaseline(next);
    setSaved(false);
  }, [data]);

  const dirty = JSON.stringify(order) !== JSON.stringify(baseline);

  function shift(idx: number, delta: number) {
    const target = idx + delta;
    if (target < 0 || target >= order.length) return;
    const next = order.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setOrder(next);
    setSaved(false);
  }

  function resetOrder() {
    setOrder(baseline);
    setSaved(false);
  }

  async function saveOrder() {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiSend("/api/dashboard/sources/priority", "PUT", { sourcePriority: order });
      setBaseline(order);
      setSaved(true);
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Gagal menyimpan prioritas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsShell
      section="sumber-data"
      title="Hierarki Prioritas Sumber Data"
      description="Tentukan urutan resolusi data saat Agent AI melakukan lookup produk, harga, atau stok. Sumber urutan pertama menjadi acuan utama."
      headerExtra={
        dirty ? (
          <span className="rounded bg-amber-50 px-2 py-1 font-mono text-[11px] font-medium text-amber-700">
            Perubahan belum disimpan
          </span>
        ) : undefined
      }
    >
      <div className="py-6">
        {loading && <p className="text-sm text-slate-500">Memuat hierarki sumber...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saveError && <p className="mb-3 text-sm text-red-600">{saveError}</p>}
        {saved && <p className="mb-3 text-sm font-medium text-green-700">Hierarki sumber data disimpan.</p>}

        {!loading && !error && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="w-20 pb-2.5">Prioritas</th>
                    <th className="pb-2.5">Sumber Data</th>
                    <th className="hidden pb-2.5 sm:table-cell">Mekanisme Sinkronisasi</th>
                    <th className="w-24 pb-2.5 text-right">Urutan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                  {order.map((type, idx) => (
                    <tr key={type} className="hover:bg-slate-50/90">
                      <td className="py-3.5 font-mono text-xs font-semibold text-slate-500">
                        <span className={cn("flex items-center gap-2", idx === 0 && "text-green-700")}>
                          <DotsSixVertical size={14} className="text-slate-300" />
                          0{idx + 1}
                        </span>
                      </td>
                      <td className="py-3.5 font-medium text-slate-900">
                        {TYPE_LABEL[type]}
                        {idx === 0 && (
                          <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-green-700">
                            PRIMARY
                          </span>
                        )}
                      </td>
                      <td className="hidden py-3.5 text-xs text-slate-500 sm:table-cell">{TYPE_SYNC[type]}</td>
                      <td className="py-3.5 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => shift(idx, -1)}
                            disabled={idx === 0}
                            aria-label="Naikkan"
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30"
                          >
                            <ArrowUp size={12} className="text-slate-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => shift(idx, 1)}
                            disabled={idx === order.length - 1}
                            aria-label="Turunkan"
                            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30"
                          >
                            <ArrowDown size={12} className="text-slate-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Gunakan tombol panah di kolom kanan untuk mengubah prioritas.
            </p>

            <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={resetOrder}
                disabled={!dirty || saving}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
              >
                Batalkan Perubahan
              </button>
              <button
                type="button"
                onClick={() => void saveOrder()}
                disabled={!dirty || saving}
                className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:pointer-events-none disabled:opacity-40"
              >
                {saving ? "Menyimpan..." : "Simpan Urutan Prioritas"}
              </button>
            </div>
          </>
        )}
      </div>
    </SettingsShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(
  async () => ({ props: {} }),
  { requiredRole: "OWNER" }
);
