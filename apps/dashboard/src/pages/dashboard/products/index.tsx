// /dashboard/products - enterprise catalog revamp (template 2026-11-22):
// telemetry strip, segmented stock pill filter, hairline table with product
// description preview, and a FULL-PAGE editor (no pop-up modal).
import { useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { ArrowLeft, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult, Product } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { TelemetryStrip } from "@/components/dashboard/telemetry-strip";
import { Toast } from "@/components/dashboard/channels/toast";
import type { ToastState } from "@/components/dashboard/channels/types";

const PAGE_SIZE = 10;

type StockFilter = "ALL" | "IN_STOCK" | "OUT_OF_STOCK";

type FormState = {
  name: string;
  sku: string;
  price: string;
  stock: string;
  description: string;
};

const EMPTY_FORM: FormState = { name: "", sku: "", price: "", stock: "0", description: "" };

function formatIDR(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function ProductsPage() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("ALL");

  // Full-page editor state (null = list view).
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  function showToast(msg: string) {
    setToast({ tone: "success", msg });
    setTimeout(() => setToast(null), 2600);
  }

  const url = `/api/dashboard/products?page=${page}&pageSize=${PAGE_SIZE}${
    search ? `&search=${encodeURIComponent(search)}` : ""
  }`;
  const { data, loading, error, refresh } = useApi<ListResult<Product>>(url);

  // KPI strip + stock filter computed over ALL products (pageSize=100 fetch).
  const all = useApi<ListResult<Product>>("/api/dashboard/products?page=1&pageSize=100");
  const allProducts = useMemo(() => all.data?.items ?? [], [all.data]);
  const kpi = useMemo(() => {
    const inStock = allProducts.filter((p) => (p.inventory?.quantity ?? 0) > 0);
    const oos = allProducts.filter((p) => (p.inventory?.quantity ?? 0) <= 0);
    const valuation = allProducts.reduce(
      (sum, p) => sum + Number(p.price) * (p.inventory?.quantity ?? 0),
      0
    );
    return { total: allProducts.length, inStock: inStock.length, oos: oos.length, valuation };
  }, [allProducts]);

  function applySearch(e: FormEvent) {
    e.preventDefault();
    setSearch(query);
    setPage(1);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      name: product.name,
      sku: product.sku ?? "",
      price: product.price,
      stock: String(product.inventory?.quantity ?? 0),
      description: product.description ?? "",
    });
    setFormError(null);
    setFormOpen(true);
  }

  function update(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name,
        sku: form.sku || undefined,
        price: form.price,
        description: form.description || undefined,
      };
      const saved = editing
        ? await apiSend<Product>(`/api/dashboard/products/${editing.id}`, "PUT", payload)
        : await apiSend<Product>("/api/dashboard/products", "POST", payload);
      // New product with an initial stock: seed the canonical Inventory row
      // (a Manual-source snapshot) so the stock filter and valuation see it.
      if (!editing && Number(form.stock) > 0 && "id" in saved) {
        await apiSend(`/api/dashboard/inventory/${saved.id}`, "PUT", {
          quantity: Number(form.stock),
          source: "MANUAL",
        }).catch(() => undefined);
      }
      setFormOpen(false);
      showToast(editing ? `Perubahan pada "${form.name}" disimpan` : `Produk "${form.name}" ditambahkan ke katalog`);
      refresh();
      all.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan produk.");
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await apiSend(`/api/dashboard/products/${toDelete.id}`, "DELETE");
      setToDelete(null);
      showToast("Produk dihapus dari katalog");
      refresh();
      all.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus produk.");
    } finally {
      setDeleting(false);
    }
  }

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    const q = search.trim().toLowerCase();
    return items.filter((p) => {
      const qty = p.inventory?.quantity ?? 0;
      const matchesStock =
        stockFilter === "ALL" ||
        (stockFilter === "IN_STOCK" && qty > 0) ||
        (stockFilter === "OUT_OF_STOCK" && qty <= 0);
      const matchesText =
        !q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q);
      return matchesStock && matchesText;
    });
  }, [data, search, stockFilter]);

  const stockPills: { key: StockFilter; label: string }[] = [
    { key: "ALL", label: "Semua" },
    { key: "IN_STOCK", label: "Tersedia (> 0)" },
    { key: "OUT_OF_STOCK", label: "Stok Kosong (0)" },
  ];

  // ─── Full-page editor view ───
  if (formOpen) {
    return (
      <DashboardShell title={editing ? "Edit Produk" : "Tambah Produk"}>
        <div className="mx-auto w-full max-w-6xl px-4 py-7 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <ArrowLeft size={12} />Produk
                </button>
                <span className="text-slate-300">/</span>
                <span className="font-medium text-slate-700">
                  {editing ? "Edit Produk" : "Tambah Produk"}
                </span>
              </div>
              <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
                {editing ? `Edit Produk - ${editing.name}` : "Tambah Produk Baru"}
              </h1>
              <p className="mt-1 text-xs text-slate-500">
                Data produk langsung tersedia untuk referensi jawaban Agent AI dan pembuatan pesanan pelanggan.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
          </div>

          <form onSubmit={onSubmit} className="divide-y divide-slate-200">
            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Identitas Produk</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Nama item yang jelas beserta kode SKU unik untuk sinkronisasi Excel &amp; Google Sheets.
                </p>
              </div>
              <div className="space-y-3.5 md:col-span-8">
                <div>
                  <label htmlFor="pf-name" className="block text-xs font-medium text-slate-700">
                    Nama Produk <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="pf-name"
                    type="text"
                    required
                    placeholder="mis. Kopi Gayo 250g"
                    value={form.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => update("name", e.target.value)}
                    className="mt-1.5 h-9 w-full max-w-md rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  />
                </div>
                <div>
                  <label htmlFor="pf-sku" className="block text-xs font-medium text-slate-700">
                    Kode SKU
                  </label>
                  <input
                    id="pf-sku"
                    type="text"
                    placeholder="mis. KPG-250"
                    value={form.sku}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => update("sku", e.target.value)}
                    className="mt-1.5 h-9 w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 font-mono text-xs uppercase text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Harga &amp; Stok Awal</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Harga jual satuan dalam Rupiah dan kuantitas stok awal pada gudang manual.
                </p>
              </div>
              <div className="grid max-w-md grid-cols-1 gap-3.5 sm:grid-cols-2 md:col-span-8">
                <div>
                  <label htmlFor="pf-price" className="block text-xs font-medium text-slate-700">
                    Harga Jual (Rp) <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="pf-price"
                    type="number"
                    min="0"
                    step="100"
                    required
                    placeholder="85000"
                    value={form.price}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => update("price", e.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  />
                </div>
                {!editing && (
                  <div>
                    <label htmlFor="pf-stock" className="block text-xs font-medium text-slate-700">
                      Stok Awal
                    </label>
                    <input
                      id="pf-stock"
                      type="number"
                      min="0"
                      step="1"
                      value={form.stock}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => update("stock", e.target.value)}
                      className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Deskripsi &amp; Konteks AI</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Spesifikasi produk, catatan rasa, atau varian yang digunakan AI saat menjawab pertanyaan pembeli.
                </p>
              </div>
              <div className="md:col-span-8">
                <textarea
                  id="pf-desc"
                  rows={4}
                  placeholder="Tulis spesifikasi singkat produk…"
                  value={form.description}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => update("description", e.target.value)}
                  className="w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                />
              </div>
            </div>

            {formError && <p className="pb-2 text-xs text-red-600">{formError}</p>}

            <div className="flex items-center justify-end gap-2.5 pt-5">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {saving ? "Menyimpan…" : editing ? "Simpan Perubahan" : "Simpan Produk"}
              </button>
            </div>
          </form>
        </div>
      </DashboardShell>
    );
  }

  // ─── List view ───
  return (
    <DashboardShell title="Produk" flush>
      <div className="mx-auto w-full max-w-6xl px-4 py-7 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Produk</h1>
            <p className="mt-1 text-xs text-slate-500">
              Kelola master katalog SKU, struktur harga dasar, dan ketersediaan item untuk Agent AI maupun pesanan manual.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
          >
            <Plus size={14} />Tambah Produk
          </button>
        </div>

        <TelemetryStrip
          cells={[
            { label: "Total SKU Terdaftar", value: String(kpi.total) },
            { label: "Tersedia (In Stock)", value: String(kpi.inStock), valueClass: "text-green-700" },
            { label: "Stok Kosong (Out of Stock)", value: String(kpi.oos), valueClass: "text-red-600" },
            { label: "Nilai Valuasi Inventaris", value: formatIDR(kpi.valuation) },
          ]}
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari nama produk atau SKU…"
                value={query}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setQuery(e.target.value);
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-8 w-64 rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-green-600 focus:outline-none"
              />
            </div>
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
              {stockPills.map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setStockFilter(pill.key)}
                  className={
                    stockFilter === pill.key
                      ? "rounded bg-white px-2.5 py-1 font-semibold text-slate-900 shadow-sm"
                      : "rounded px-2.5 py-1 font-medium text-slate-600 hover:text-slate-900"
                  }
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>
          <span className="font-mono text-[11px] text-slate-400">Mata uang: IDR</span>
        </div>

        {loading && <StateNotice variant="loading" message="Memuat produk…" className="mt-4" />}
        {error && <StateNotice variant="error" message={error} className="mt-4" />}
        {!loading && !error && (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 pr-4">Produk</th>
                    <th className="px-4 py-3">Kode SKU</th>
                    <th className="px-4 py-3 text-right">Harga Satuan</th>
                    <th className="px-4 py-3 text-right">Stok</th>
                    <th className="hidden px-4 py-3 md:table-cell">Dibuat</th>
                    <th className="py-3 pl-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                        Tidak ada produk yang sesuai dengan kriteria filter.
                      </td>
                    </tr>
                  )}
                  {filteredItems.map((p) => {
                    const qty = p.inventory?.quantity ?? 0;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80">
                        <td className="py-3.5 pr-4">
                          <p className="text-xs font-semibold text-slate-900">{p.name}</p>
                          {p.description && (
                            <p className="mt-0.5 line-clamp-1 max-w-md text-[11px] text-slate-500">
                              {p.description}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{p.sku || "-"}</td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs font-medium tabular-nums text-slate-900">
                          {formatIDR(p.price)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {qty > 0 ? (
                            <span className="font-mono text-xs font-medium tabular-nums text-slate-900">{qty}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-red-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                              0 (Habis)
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-500 md:table-cell">
                          {formatDate(p.createdAt)}
                        </td>
                        <td className="py-3.5 pl-4 text-right">
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              className="text-xs font-medium text-slate-700 hover:text-slate-950"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setToDelete(p)}
                              className="text-xs font-medium text-red-600 hover:underline"
                            >
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Produk dari Katalog"
        description={`Apakah Anda yakin ingin menghapus "${toDelete?.name ?? ""}" secara permanen? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus Permanen"
        destructive
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
      <Toast toast={toast} />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(async () => ({ props: {} }));
