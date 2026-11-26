// /dashboard/products - enterprise catalog revamp (template 2026-11-22):
// telemetry strip, segmented stock pill filter, hairline table with product
// description preview, and a FULL-PAGE editor (no pop-up modal).
// PRD 32: product types (Fisik / Digital / Unduhan / Kursus) with
// type-driven editor fields, optional tenant category, searchable
// pick-or-add course level, and kuota wording for COURSE products.
import { useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { ArrowLeft, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type {
  CourseDurationUnitKey,
  CourseLevel,
  ListResult,
  Product,
  ProductCategory,
  ProductTypeKey,
} from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { TelemetryStrip } from "@/components/dashboard/telemetry-strip";
import { FlushPage } from "@/components/dashboard/flush-page";
import { Toast } from "@/components/dashboard/channels/toast";
import type { ToastState } from "@/components/dashboard/channels/types";

const PAGE_SIZE = 10;

type StockFilter = "ALL" | "IN_STOCK" | "OUT_OF_STOCK";

const TYPE_LABEL: Record<ProductTypeKey, string> = {
  PHYSICAL: "Produk Fisik",
  DIGITAL: "Produk Digital",
  DOWNLOADABLE: "Produk Unduhan",
  COURSE: "Kursus/Program",
};

const TYPE_BADGE: Record<ProductTypeKey, string> = {
  PHYSICAL: "border-slate-200 bg-slate-100 text-slate-600",
  DIGITAL: "border-blue-200 bg-blue-50 text-blue-700",
  DOWNLOADABLE: "border-violet-200 bg-violet-50 text-violet-700",
  COURSE: "border-amber-200 bg-amber-50 text-amber-700",
};

const DURATION_LABEL: Record<CourseDurationUnitKey, string> = {
  MINGGU: "Minggu",
  BULAN: "Bulan",
  TAHUN: "Tahun",
};

// PRD 32: tracked types own an Inventory row (stok / kuota).
function isTracked(type: ProductTypeKey): boolean {
  return type === "PHYSICAL" || type === "COURSE";
}

type FormState = {
  name: string;
  sku: string;
  price: string;
  stock: string;
  description: string;
  type: ProductTypeKey;
  categoryId: string;
  newCategory: string;
  levelName: string;
  deliveryInfo: string;
  durationValue: string;
  durationUnit: CourseDurationUnitKey;
};

const EMPTY_FORM: FormState = {
  name: "",
  sku: "",
  price: "",
  stock: "0",
  description: "",
  type: "PHYSICAL",
  categoryId: "",
  newCategory: "",
  levelName: "",
  deliveryInfo: "",
  durationValue: "",
  durationUnit: "MINGGU",
};

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
  const [categoryFilter, setCategoryFilter] = useState("");

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
  }${categoryFilter ? `&categoryId=${categoryFilter}` : ""}`;
  const { data, loading, error, refresh } = useApi<ListResult<Product>>(url);
  const categoriesApi = useApi<ProductCategory[]>("/api/dashboard/product-categories");
  const levelsApi = useApi<CourseLevel[]>("/api/dashboard/course-levels");
  const categories = categoriesApi.data ?? [];
  const levels = levelsApi.data ?? [];

  // KPI strip + stock filter computed over ALL products (pageSize=100 fetch).
  const all = useApi<ListResult<Product>>("/api/dashboard/products?page=1&pageSize=100");
  const allProducts = useMemo(() => all.data?.items ?? [], [all.data]);
  const kpi = useMemo(() => {
    // PRD 32: only tracked products (stok/kuota) count toward stock KPIs;
    // digital products are never "out of stock".
    const tracked = allProducts.filter((p) => isTracked(p.type));
    const inStock = tracked.filter((p) => (p.inventory?.quantity ?? 0) > 0);
    const oos = tracked.filter((p) => (p.inventory?.quantity ?? 0) <= 0);
    const valuation = tracked.reduce(
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
      type: product.type,
      categoryId: product.categoryId ?? "",
      newCategory: "",
      levelName: product.level?.name ?? "",
      deliveryInfo: product.deliveryInfo ?? "",
      durationValue: product.durationValue !== null ? String(product.durationValue) : "",
      durationUnit: product.durationUnit ?? "MINGGU",
    });
    setFormError(null);
    setFormOpen(true);
  }

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function resolveCategory(): Promise<string | undefined> {
    if (form.categoryId === "__new") {
      if (!form.newCategory.trim()) return undefined;
      const created = await apiSend<ProductCategory>(
        "/api/dashboard/product-categories",
        "POST",
        { name: form.newCategory.trim() }
      );
      return created.id;
    }
    return form.categoryId || undefined;
  }

  async function resolveLevel(): Promise<string | null> {
    const name = form.levelName.trim();
    if (!name) return null;
    const existing = levels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const created = await apiSend<CourseLevel>("/api/dashboard/course-levels", "POST", { name });
    return created.id;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const categoryId = await resolveCategory();
      const tracked = isTracked(form.type);

      const base: Record<string, unknown> = {
        name: form.name,
        sku: form.sku || undefined,
        price: form.price,
        description: form.description || undefined,
        type: form.type,
        ...(categoryId ? { categoryId } : {}),
      };
      if (form.type === "DIGITAL" || form.type === "DOWNLOADABLE") {
        base.deliveryInfo = form.deliveryInfo || undefined;
      }
      if (form.type === "COURSE") {
        if (form.durationValue) {
          const value = Number(form.durationValue);
          if (!Number.isInteger(value) || value < 1) {
            throw new Error("Durasi harus angka bulat minimal 1.");
          }
          base.durationValue = value;
          base.durationUnit = form.durationUnit;
        }
      }

      let saved: Product;
      if (editing) {
        // PUT is partial: clear stale type-specific fields explicitly so
        // switching type never leaves orphaned data behind. The category is
        // always sent (null clears it) since it is optional.
        const levelId = form.type === "COURSE" ? await resolveLevel() : null;
        const payload: Record<string, unknown> = { ...base, categoryId: categoryId ?? null };
        payload.deliveryInfo =
          form.type === "DIGITAL" || form.type === "DOWNLOADABLE"
            ? form.deliveryInfo || null
            : null;
        payload.levelId = levelId;
        payload.durationValue =
          form.type === "COURSE" && form.durationValue ? Number(form.durationValue) : null;
        payload.durationUnit = form.type === "COURSE" && form.durationValue ? form.durationUnit : null;
        saved = await apiSend<Product>(`/api/dashboard/products/${editing.id}`, "PUT", payload);
      } else {
        const levelId = form.type === "COURSE" ? await resolveLevel() : undefined;
        const payload: Record<string, unknown> = { ...base };
        if (levelId) payload.levelId = levelId;
        saved = await apiSend<Product>("/api/dashboard/products", "POST", payload);
        // New tracked product with an initial stok/kuota: set the canonical
        // Inventory row (created at quantity 0 by the API).
        if (tracked && Number(form.stock) > 0 && saved.id) {
          await apiSend(`/api/dashboard/inventory/${saved.id}`, "PUT", {
            quantity: Number(form.stock),
            source: "MANUAL",
          }).catch(() => undefined);
        }
      }
      setFormOpen(false);
      showToast(editing ? `Perubahan pada "${form.name}" disimpan` : `Produk "${form.name}" ditambahkan ke katalog`);
      refresh();
      all.refresh();
      categoriesApi.refresh();
      levelsApi.refresh();
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
      const tracked = isTracked(p.type);
      const qty = p.inventory?.quantity ?? 0;
      // Stock pills apply to tracked products only; digital products are
      // always "available" and only show under "Semua".
      const matchesStock =
        stockFilter === "ALL"
          ? true
          : tracked &&
            ((stockFilter === "IN_STOCK" && qty > 0) ||
              (stockFilter === "OUT_OF_STOCK" && qty <= 0));
      const matchesText =
        !q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q);
      return matchesStock && matchesText;
    });
  }, [data, search, stockFilter]);

  const stockPills: { key: StockFilter; label: string }[] = [
    { key: "ALL", label: "Semua" },
    { key: "IN_STOCK", label: "Tersedia (> 0)" },
    { key: "OUT_OF_STOCK", label: "Stok/Kuota Kosong (0)" },
  ];

  // ─── Full-page editor view ───
  if (formOpen) {
    return (
      <DashboardShell title={editing ? "Edit Produk" : "Tambah Produk"}>
        <div className="w-full px-4 py-7 md:px-8">
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
            {/* Jenis produk - drives which fields apply (PRD 32) */}
            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Jenis Produk</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Jenis menentukan field yang tersedia dan cara ketersediaan dihitung. Jenis bisa diubah kapan saja.
                </p>
              </div>
              <div className="md:col-span-8">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Jenis produk">
                  {(Object.keys(TYPE_LABEL) as ProductTypeKey[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={form.type === t}
                      onClick={() => update("type", t)}
                      className={
                        form.type === t
                          ? "rounded-lg border border-green-600 bg-green-50 px-3.5 py-2 text-xs font-semibold text-green-700"
                          : "rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:border-slate-300"
                      }
                    >
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  {form.type === "PHYSICAL"
                    ? "Barang fisik dengan stok gudang. Setiap pesanan mengurangi stok."
                    : form.type === "COURSE"
                      ? "Kelas atau program dengan kuota peserta. Kuota berkurang saat pesanan dibuat dan dikembalikan saat pesanan dibatalkan."
                      : form.type === "DIGITAL"
                        ? "Produk digital tanpa batas kuantitas: voucher, kode lisensi, atau akun. Pengiriman diatur lewat catatan pengiriman."
                        : "Produk unduhan tanpa batas kuantitas. Isi tautan unduhan yang dikirim ke pembeli."}
                </p>
              </div>
            </div>

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
                    placeholder={
                      form.type === "COURSE"
                        ? "mis. Kelas English for Business"
                        : "mis. Kopi Gayo 250g"
                    }
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
                {/* Kategori (PRD 32) */}
                <div>
                  <label htmlFor="pf-category" className="block text-xs font-medium text-slate-700">
                    Kategori
                  </label>
                  {form.categoryId === "__new" ? (
                    <div className="mt-1.5 flex max-w-md gap-2">
                      <input
                        id="pf-category"
                        type="text"
                        autoFocus
                        placeholder="mis. Perlengkapan"
                        value={form.newCategory}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update("newCategory", e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                      />
                      <button
                        type="button"
                        onClick={() => update("categoryId", "")}
                        className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Batal
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex max-w-md gap-2">
                      <select
                        id="pf-category"
                        value={form.categoryId}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => update("categoryId", e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none"
                      >
                        <option value="">Tanpa kategori</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                        <option value="__new">+ Kategori baru...</option>
                      </select>
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-slate-500">Opsional, untuk pengelompokan produk.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">
                  Harga {isTracked(form.type) ? "& Kuantitas Awal" : ""}
                </span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {form.type === "PHYSICAL"
                    ? "Harga jual satuan dalam Rupiah dan stok awal pada gudang manual."
                    : form.type === "COURSE"
                      ? "Harga per peserta dan kuota awal kelas."
                      : "Harga jual dalam Rupiah. Produk digital tidak memakai kuantitas."}
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
                {!editing && isTracked(form.type) && (
                  <div>
                    <label htmlFor="pf-stock" className="block text-xs font-medium text-slate-700">
                      {form.type === "COURSE" ? "Kuota Awal" : "Stok Awal"}
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

            {/* COURSE: level + durasi (PRD 32) */}
            {form.type === "COURSE" && (
              <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
                <div className="md:col-span-4">
                  <span className="text-xs font-semibold text-slate-900">Level &amp; Durasi</span>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Ketik untuk mencari level yang sudah ada; nama baru otomatis ditambahkan ke daftar.
                  </p>
                </div>
                <div className="grid max-w-md grid-cols-1 gap-3.5 sm:grid-cols-2 md:col-span-8">
                  <div>
                    <label htmlFor="pf-level" className="block text-xs font-medium text-slate-700">
                      Level
                    </label>
                    <input
                      id="pf-level"
                      type="text"
                      list="pf-level-options"
                      placeholder="mis. Intermediate"
                      value={form.levelName}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => update("levelName", e.target.value)}
                      className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                    />
                    <datalist id="pf-level-options">
                      {levels.map((l) => (
                        <option key={l.id} value={l.name} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label htmlFor="pf-duration" className="block text-xs font-medium text-slate-700">
                      Durasi
                    </label>
                    <div className="mt-1.5 flex">
                      <input
                        id="pf-duration"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="mis. 8"
                        value={form.durationValue}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update("durationValue", e.target.value)}
                        className="h-9 w-20 rounded-l-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                      />
                      <select
                        aria-label="Satuan durasi"
                        value={form.durationUnit}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                          update("durationUnit", e.target.value === "BULAN" ? "BULAN" : e.target.value === "TAHUN" ? "TAHUN" : "MINGGU")
                        }
                        className="h-9 rounded-r-md border border-l-0 border-slate-300 bg-white px-2 text-sm text-slate-900 focus:border-green-600 focus:outline-none"
                      >
                        {(Object.keys(DURATION_LABEL) as CourseDurationUnitKey[]).map((u) => (
                          <option key={u} value={u}>
                            {DURATION_LABEL[u]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DIGITAL / DOWNLOADABLE: delivery info (PRD 32) */}
            {(form.type === "DIGITAL" || form.type === "DOWNLOADABLE") && (
              <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
                <div className="md:col-span-4">
                  <span className="text-xs font-semibold text-slate-900">
                    {form.type === "DOWNLOADABLE" ? "Tautan Unduhan" : "Cara Pengiriman"}
                  </span>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {form.type === "DOWNLOADABLE"
                      ? "Tautan yang dikirim Agent AI ke pembeli setelah pesanan dibuat."
                      : "Instruksi, kode voucher, atau info akun yang dikirim Agent AI ke pembeli setelah pesanan dibuat."}
                  </p>
                </div>
                <div className="md:col-span-8">
                  <textarea
                    id="pf-delivery"
                    rows={3}
                    placeholder={
                      form.type === "DOWNLOADABLE"
                        ? "mis. https://tokokopi.id/unduh/modul-1.pdf"
                        : "mis. Voucher dikirim lewat email dalam 1x24 jam setelah pembayaran."
                    }
                    value={form.deliveryInfo}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => update("deliveryInfo", e.target.value)}
                    className="w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  />
                </div>
              </div>
            )}

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
                  placeholder="Tulis spesifikasi singkat produk..."
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
                {saving ? "Menyimpan..." : editing ? "Simpan Perubahan" : "Simpan Produk"}
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
      <FlushPage>
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
            { label: "Stok/Kuota Kosong", value: String(kpi.oos), valueClass: "text-red-600" },
            { label: "Nilai Valuasi Inventaris", value: formatIDR(kpi.valuation) },
          ]}
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={applySearch} className="relative">
              <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari nama produk atau SKU..."
                value={query}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setQuery(e.target.value);
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-8 w-64 rounded-md border border-slate-300 bg-white pl-8 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:border-green-600 focus:outline-none"
              />
            </form>
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
            <select
              aria-label="Filter kategori"
              value={categoryFilter}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:border-green-600 focus:outline-none"
            >
              <option value="">Semua kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <span className="font-mono text-[11px] text-slate-400">Mata uang: IDR</span>
        </div>

        {loading && <StateNotice variant="loading" message="Memuat produk..." className="mt-4" />}
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
                    <th className="px-4 py-3 text-right">Ketersediaan</th>
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
                    const tracked = isTracked(p.type);
                    const qty = p.inventory?.quantity ?? 0;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80">
                        <td className="py-3.5 pr-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-semibold text-slate-900">{p.name}</p>
                            <span
                              className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium ${TYPE_BADGE[p.type]}`}
                            >
                              {TYPE_LABEL[p.type]}
                            </span>
                            {p.category && (
                              <span className="inline-flex whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                {p.category.name}
                              </span>
                            )}
                            {p.type === "COURSE" && p.level && (
                              <span className="inline-flex whitespace-nowrap rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                {p.level.name}
                              </span>
                            )}
                          </div>
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
                          {tracked ? (
                            qty > 0 ? (
                              <span className="font-mono text-xs font-medium tabular-nums text-slate-900">{qty}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-red-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                0 (Habis)
                              </span>
                            )
                          ) : (
                            <span className="text-[11px] font-medium text-slate-500">Tanpa batas</span>
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
      </FlushPage>

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
