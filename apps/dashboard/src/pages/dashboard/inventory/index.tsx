// /dashboard/inventory - enterprise multi-source ledger revamp (template
// 2026-11-22): hairline table with source badge + last sync, and a FULL-PAGE
// stock adjustment view (no collapsible, no modal) showing the per-source
// snapshot breakdown with confidence.
import { useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { ArrowLeft, MagnifyingGlass, SlidersHorizontal } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type {
  InventorySnapshotRow,
  InventoryWithProduct,
  ListResult,
} from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { FlushPage } from "@/components/dashboard/flush-page";
import { Pagination } from "@/components/dashboard/pagination";
import { Toast } from "@/components/dashboard/channels/toast";
import type { ToastState } from "@/components/dashboard/channels/types";

const PAGE_SIZE = 10;

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Manual",
  EXCEL: "Excel",
  GOOGLE_SHEETS: "Google Sheets",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function InventoryPage() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  // Full-page adjustment state.
  const [active, setActive] = useState<InventoryWithProduct | null>(null);
  const [snapshots, setSnapshots] = useState<InventorySnapshotRow[] | null>(null);
  const [qty, setQty] = useState("0");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  function showToast(msg: string) {
    setToast({ tone: "success", msg });
    setTimeout(() => setToast(null), 2600);
  }

  const url = `/api/dashboard/inventory?page=${page}&pageSize=${PAGE_SIZE}${
    search ? `&search=${encodeURIComponent(search)}` : ""
  }`;
  const { data, loading, error, refresh } = useApi<ListResult<InventoryWithProduct>>(url);

  function openDetail(inv: InventoryWithProduct) {
    setActive(inv);
    setQty(String(inv.quantity));
    setFormError(null);
    setSnapshots(null);
    apiFetch<{ snapshots: InventorySnapshotRow[] }>(
      `/api/dashboard/inventory/${inv.productId}`
    )
      .then((r) => setSnapshots(r.snapshots))
      .catch(() => setSnapshots([]));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!active) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiSend(`/api/dashboard/inventory/${active.productId}`, "PUT", {
        quantity: Number(qty),
        source: "MANUAL",
      });
      const name = active.product.name;
      setActive(null);
      showToast(`Stok ${name} diperbarui menjadi ${qty} unit`);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal memperbarui stok.");
    } finally {
      setSaving(false);
    }
  }

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (inv) =>
        inv.product.name.toLowerCase().includes(q) ||
        (inv.product.sku ?? "").toLowerCase().includes(q)
    );
  }, [data, search]);

  // ─── Full-page adjustment view ───
  if (active) {
    return (
      <DashboardShell title="Sesuaikan Stok">
        <div className="w-full px-4 py-7 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <ArrowLeft size={12} />Inventaris
                </button>
                <span className="text-slate-300">/</span>
                <span className="font-medium text-slate-700">Penyesuaian Stok</span>
              </div>
              <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
                Sesuaikan Stok - {active.product.name}
              </h1>
              <p className="mt-1 font-mono text-xs text-slate-500">
                SKU: {active.product.sku || "-"} - Sumber Utama: {SOURCE_LABEL[active.source] ?? active.source} - Stok Aktif: {active.quantity} unit
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActive(null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Kembali ke Inventaris
            </button>
          </div>

          <div className="divide-y divide-slate-200">
            {/* Section 1: per-source breakdown */}
            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <h2 className="text-xs font-semibold text-slate-900">Rincian Stok per Sumber Data</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Perbandingan kuantitas stok dari masing-masing konektor yang terhubung ke katalog produk ini.
                </p>
              </div>
              <div className="md:col-span-8">
                <div className="overflow-x-auto border-y border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-2.5">Sumber Data</th>
                        <th className="px-3 py-2.5 text-right">Kuantitas</th>
                        <th className="px-3 py-2.5">Sinkronisasi Terakhir</th>
                        <th className="px-3 py-2.5 text-right">Tingkat Keyakinan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {snapshots === null && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                            Memuat snapshot…
                          </td>
                        </tr>
                      )}
                      {snapshots?.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                            Belum ada snapshot sumber. Stok kanonis tersimpan pada baris Manual.
                          </td>
                        </tr>
                      )}
                      {snapshots?.map((s) => (
                        <tr key={s.id}>
                          <td className="px-3 py-2.5 font-medium text-slate-800">
                            {SOURCE_LABEL[s.source] ?? s.source}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                            {s.quantity} unit
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-500">
                            {formatDate(s.syncedAt)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-green-700">
                            {Math.round(s.confidence * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Section 2: manual override */}
            <form onSubmit={onSave} className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <label htmlFor="inv-detail-qty" className="text-xs font-semibold text-slate-900">
                  Pembaruan Stok Manual
                </label>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Menimpa nilai stok aktif pada sumber Manual dan langsung memperbarui status ketersediaan untuk Agent AI.
                </p>
              </div>
              <div className="max-w-md space-y-4 md:col-span-8">
                <div>
                  <label htmlFor="inv-detail-qty" className="block text-xs font-medium text-slate-700">
                    Jumlah Stok Baru (Unit) <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="inv-detail-qty"
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={qty}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setQty(e.target.value)}
                    className="mt-1.5 h-9 w-40 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  />
                </div>
                {formError && <p className="text-xs text-red-600">{formError}</p>}
                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                  >
                    {saving ? "Menyimpan…" : "Simpan Stok Baru"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActive(null)}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Batal
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </DashboardShell>
    );
  }

  // ─── List view ───
  return (
    <DashboardShell title="Inventaris" flush>
      <FlushPage>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Inventaris</h1>
            <p className="mt-1 text-xs text-slate-500">
              Pantau posisi stok lintas sumber (Excel, Google Sheets, Manual) dan kelola penyesuaian kuantitas pada halaman detail.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Prioritas: Excel -&gt; Google Sheets -&gt; Manual
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <div className="relative">
            <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari produk di inventaris…"
              value={query}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setQuery(e.target.value);
                setSearch(e.target.value);
                setPage(1);
              }}
              className="h-8 w-64 rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-green-600 focus:outline-none"
            />
          </div>
          <p className="text-xs text-slate-400">
            Klik <strong className="font-medium text-slate-600">Sesuaikan Stok</strong> untuk membuka rincian sumber &amp; pembaruan stok.
          </p>
        </div>

        {loading && <StateNotice variant="loading" message="Memuat inventaris…" className="mt-4" />}
        {error && <StateNotice variant="error" message={error} className="mt-4" />}
        {!loading && !error && (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 pr-4">Produk</th>
                    <th className="px-4 py-3 text-right">Stok Efektif</th>
                    <th className="px-4 py-3">Sumber Utama</th>
                    <th className="hidden px-4 py-3 sm:table-cell">Sinkronisasi Terakhir</th>
                    <th className="py-3 pl-4 text-right">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-xs text-slate-400">
                        Tidak ada data inventaris yang ditemukan.
                      </td>
                    </tr>
                  )}
                  {filteredItems.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/80">
                      <td className="py-3.5 pr-4">
                        <span className="text-xs font-semibold text-slate-900">{inv.product.name}</span>
                        {inv.product.sku && (
                          <span className="ml-2 font-mono text-[11px] text-slate-400">{inv.product.sku}</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {inv.quantity > 0 ? (
                          <span className="font-mono text-xs font-semibold tabular-nums text-slate-900">
                            {inv.quantity} unit
                          </span>
                        ) : (
                          <span className="font-mono text-xs font-semibold tabular-nums text-red-600">
                            0 unit
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {SOURCE_LABEL[inv.source] ?? inv.source}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-500 sm:table-cell">
                        {formatDate(inv.updatedAt)}
                      </td>
                      <td className="py-3.5 pl-4 text-right">
                        <button
                          type="button"
                          onClick={() => openDetail(inv)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-green-700 transition hover:border-green-300 hover:bg-green-50"
                        >
                          <SlidersHorizontal size={12} />Sesuaikan Stok
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data && (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </FlushPage>
      <Toast toast={toast} />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(async () => ({ props: {} }));
