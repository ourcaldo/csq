import { useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import {
  AddressBook,
  CaretDown,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Copy,
  DownloadSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  UploadSimple,
  Warning,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend, ApiError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, Contact, ListResult, Tag } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { cn } from "@csq/ui/lib/utils";
import { readableTextColor } from "@/lib/tag-color";

const PAGE_SIZE = 10;

// Contacts page - redesign 2026-11-18 (docs/demo/new/kontak_csq_crm_dashboard
// .html): 4 metric cards, unified table (live search + category/tag dropdown
// filters + pagination), and slide-over drawers for Edit / Tambah / Impor.
// Export CSV stays a header action. All wired to the existing BFF routes.

type ContactRow = Contact & {
  categories?: { categoryId: string; category: Category }[];
  tags?: { tagId: string; tag: Tag }[];
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Gagal membaca berkas."));
        return;
      }
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("Gagal membaca berkas."));
    reader.readAsDataURL(file);
  });
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

function Chip({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={color ? { backgroundColor: color, color: readableTextColor(color) ?? undefined } : undefined}
    >
      {name}
    </span>
  );
}

export default function ContactsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data: catsData } = useApi<Category[]>("/api/dashboard/contact-categories");
  const { data: tagsData } = useApi<ListResult<Tag>>("/api/dashboard/tags?pageSize=100");
  const categories = catsData ?? [];
  const tags = tagsData?.items ?? [];

  // Filters (client-side over the fetched page set - same model as the old
  // page: the API paginates, the toolbar narrows within the visible set).
  const [search, setSearch] = useState("");
  const [fCat, setFCat] = useState("");
  const [fTag, setFTag] = useState("");

  const url = `/api/dashboard/contacts?page=1&pageSize=200`;
  const { data, loading, error, refresh } = useApi<ListResult<ContactRow>>(url);
  const all = useMemo(() => data?.items ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((c) => {
      const okQ =
        !q ||
        (c.name ?? "").toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.email ?? "").toLowerCase().includes(q);
      const okC =
        !fCat || (c.categories ?? []).some((x) => x.category.id === fCat);
      const okT = !fTag || (c.tags ?? []).some((x) => x.tag.id === fTag);
      return okQ && okC && okT;
    });
  }, [all, search, fCat, fTag]);

  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const view = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Stats strip
  const stats = {
    total: all.length,
    unnamed: all.filter((c) => !c.name).length,
    withCats: all.filter((c) => (c.categories ?? []).length > 0).length,
    withTags: all.filter((c) => (c.tags ?? []).length > 0).length,
  };

  // ── Drawer state ──
  const [drawer, setDrawer] = useState<"edit" | "add" | "import" | null>(null);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  // Edit/Add form state
  const [form, setForm] = useState({ phone: "", name: "", email: "", notes: "" });
  const [selCats, setSelCats] = useState<string[]>([]);
  const [selTags, setSelTags] = useState<string[]>([]);

  function openEdit(c: ContactRow) {
    setEditing(c);
    setForm({ phone: c.phone, name: c.name ?? "", email: c.email ?? "", notes: c.notes ?? "" });
    setSelCats((c.categories ?? []).map((x) => x.category.id));
    setSelTags((c.tags ?? []).map((x) => x.tag.id));
    setDrawerError(null);
    setDrawer("edit");
  }

  function openAdd() {
    setEditing(null);
    setForm({ phone: "", name: "", email: "", notes: "" });
    setSelCats([]);
    setSelTags([]);
    setDrawerError(null);
    setDrawer("add");
  }

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  function openImport() {
    setImportFile(null);
    setImportResult(null);
    setDrawerError(null);
    setDrawer("import");
  }

  function toggleIn(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function saveContact(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setDrawerError(null);
    try {
      if (editing) {
        await apiSend(`/api/dashboard/contacts/${editing.id}`, "PUT", {
          name: form.name.trim() || null,
          email: form.email.trim() || null,
          notes: form.notes.trim() || null,
          categoryIds: selCats,
          tagIds: selTags,
        });
        showToast("Perubahan kontak disimpan");
      } else {
        const digits = form.phone.replace(/[^0-9]/g, "");
        if (digits.length < 8) {
          setDrawerError("Nomor telepon tidak valid (minimal 8 digit).");
          return;
        }
        await apiSend("/api/dashboard/contacts", "POST", {
          phone: form.phone.trim(),
          name: form.name.trim() || undefined,
          email: form.email.trim() || undefined,
          notes: form.notes.trim() || undefined,
          categoryIds: selCats,
          tagIds: selTags,
        });
        showToast("Kontak baru ditambahkan");
      }
      setDrawer(null);
      setPage(1);
      refresh();
    } catch (e) {
      setDrawerError(errMsg(e, "Gagal menyimpan kontak."));
    } finally {
      setBusy(false);
    }
  }

  async function doImport(e: FormEvent) {
    e.preventDefault();
    if (!importFile) {
      setDrawerError("Pilih berkas .csv atau .xlsx terlebih dahulu.");
      return;
    }
    setBusy(true);
    setDrawerError(null);
    try {
      const base64 = await fileToBase64(importFile);
      const res = await apiSend<{ created: number; skipped: number; errors: string[] }>(
        "/api/dashboard/contacts/import",
        "POST",
        { filename: importFile.name, base64 }
      );
      setImportResult(
        `${res.created} kontak ditambahkan` +
          (res.skipped > 0 ? `, ${res.skipped} dilewati (duplikat atau tidak valid)` : "") +
          "."
      );
      setPage(1);
      refresh();
    } catch (e) {
      setDrawerError(errMsg(e, "Impor gagal."));
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    window.location.href = "/api/dashboard/contacts/export";
    showToast("Berkas CSV kontak diunduh");
  }

  function openChat(c: ContactRow) {
    void router.push(`/dashboard/inbox?c=&phone=${c.phone}`).catch(() => undefined);
    // The inbox does not deep-link by phone; land on the inbox where the
    // owner can search the number.
    void router.push("/dashboard/inbox");
  }

  const hasFilter = !!search || !!fCat || !!fTag;

  return (
    <DashboardShell
      title="Kontak"
      description="Data pelanggan terpusat dari percakapan WhatsApp dan impor manual."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs transition hover:bg-slate-50"
          >
            <DownloadSimple size={14} className="text-slate-500" />
            <span>Ekspor CSV</span>
          </button>
          {isOwner && (
            <>
              <button
                onClick={openImport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs transition hover:bg-slate-50"
              >
                <UploadSimple size={14} className="text-slate-500" />
                <span>Impor</span>
              </button>
              <button
                onClick={openAdd}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-green-700 active:scale-[0.99]"
              >
                <Plus size={14} weight="bold" />
                <span>Tambah Kontak</span>
              </button>
            </>
          )}
        </div>
      }
    >
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <LoadingSkeleton rows={3} />}

      {/* ══ Quick Summary Strip ══ */}
      {!loading && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Kontak" value={stats.total} />
          <StatCard label="Punya Kategori" value={stats.withCats} />
          <StatCard label="Punya Tag" value={stats.withTags} />
          <StatCard label="Tanpa Nama" value={stats.unnamed} />
        </div>
      )}

      {/* ══ Unified Table Card ══ */}
      {!loading && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* Toolbar */}
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 bg-slate-50/50 p-4 sm:flex-row sm:items-center">
            <form
              className="flex flex-1 flex-wrap items-center gap-2"
              onSubmit={(e) => e.preventDefault()}
            >
              <div className="relative w-full sm:max-w-xs">
                <MagnifyingGlass
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Cari nama, telepon, atau email…"
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div className="relative">
                <select
                  value={fCat}
                  onChange={(e) => {
                    setFCat(e.target.value);
                    setPage(1);
                  }}
                  className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-slate-700 focus:border-slate-400 focus:outline-none"
                >
                  <option value="">Semua kategori</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <CaretDown
                  size={12}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>

              <div className="relative">
                <select
                  value={fTag}
                  onChange={(e) => {
                    setFTag(e.target.value);
                    setPage(1);
                  }}
                  className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-slate-700 focus:border-slate-400 focus:outline-none"
                >
                  <option value="">Semua tag</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <CaretDown
                  size={12}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
              </div>

              {hasFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setFCat("");
                    setFTag("");
                    setPage(1);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200/60 hover:text-slate-800"
                >
                  <X size={12} /> Reset
                </button>
              )}
            </form>

            <div className="text-xs tabular-nums text-slate-500">
              {hasFilter
                ? `Ditemukan ${filtered.length} dari ${all.length} kontak`
                : `Total ${all.length} kontak`}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Pelanggan</th>
                  <th className="px-4 py-3">No. Telepon</th>
                  <th className="hidden px-4 py-3 md:table-cell">Kategori</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Tag</th>
                  <th className="hidden px-4 py-3 xl:table-cell">Catatan</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {view.map((c) => (
                  <tr key={c.id} className="group transition-colors hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                            c.name
                              ? "border-green-200/70 bg-green-50 text-green-700"
                              : "border-slate-200 bg-slate-100 text-slate-500"
                          )}
                        >
                          {initials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <p className={cn("truncate text-sm font-medium", c.name ? "text-slate-900" : "italic text-slate-400")}>
                            {c.name ?? "Tanpa Nama"}
                          </p>
                          <p className="truncate text-xs text-slate-400">
                            {c.email ?? "Tidak ada email"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-mono text-xs font-medium tabular-nums text-slate-700">
                          +{c.phone}
                        </span>
                        <button
                          title="Salin nomor"
                          onClick={() => {
                            void navigator.clipboard.writeText(c.phone);
                            showToast(`Nomor +${c.phone} disalin`);
                          }}
                          className="rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-200/70 hover:text-slate-700 group-hover:opacity-100"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {(c.categories ?? []).length > 0 ? (
                          (c.categories ?? []).map((x) => (
                            <Chip key={x.category.id} name={x.category.name} color={x.category.color} />
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">&mdash;</span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {(c.tags ?? []).length > 0 ? (
                          (c.tags ?? []).map((x) => (
                            <Chip key={x.tag.id} name={x.tag.name} color={x.tag.color} />
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">&mdash;</span>
                        )}
                      </div>
                    </td>
                    <td className="hidden max-w-[200px] truncate px-4 py-3 text-xs text-slate-500 xl:table-cell">
                      {c.notes ?? <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          title="Kirim Pesan WhatsApp"
                          onClick={() => void router.push("/dashboard/inbox")}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-green-200 hover:bg-green-50 hover:text-green-700"
                        >
                          <WhatsappLogo size={16} />
                        </button>
                        {isOwner && (
                          <button
                            onClick={() => openEdit(c)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            <PencilSimple size={12} className="text-slate-500" /> Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && view.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                        <AddressBook size={20} />
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-900">Tidak ada kontak ditemukan</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Coba ubah kata kunci pencarian atau reset filter kategori & tag.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-50/40 px-4">
              <div className="flex flex-col gap-3 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span className="tabular-nums">
                  Menampilkan{" "}
                  <strong className="font-medium text-slate-800">
                    {(page - 1) * PAGE_SIZE + 1}&ndash;{Math.min(filtered.length, page * PAGE_SIZE)}
                  </strong>{" "}
                  dari <strong className="font-medium text-slate-800">{filtered.length}</strong> kontak
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <CaretLeft size={12} /> Sebelumnya
                  </button>
                  <span className="min-w-[6.5rem] text-center font-medium tabular-nums text-slate-700">
                    Hal. {page} / {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Berikutnya <CaretRight size={12} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ Slide-over Drawers ═══════════ */}

      <Drawer open={drawer === "edit"} onClose={() => setDrawer(null)} title="Edit Kontak" subtitle={`+${editing?.phone ?? ""}`}>
        <form className="flex flex-1 flex-col overflow-hidden" onSubmit={saveContact}>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {drawerError && <FormError msg={drawerError} />}
            <FormInput label="Nama Pelanggan" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Nama lengkap pelanggan" />
            <FormInput label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="email@contoh.com" />
            <TaxonomyPicker label="Kategori" rows={categories} selected={selCats} onToggle={(id) => setSelCats((l) => toggleIn(l, id))} />
            <TaxonomyPicker label="Tag" rows={tags} selected={selTags} onToggle={(id) => setSelTags((l) => toggleIn(l, id))} />
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Catatan Internal</label>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Preferensi pesanan, alamat pengiriman, dll."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>
          <DrawerFooter>
            <button type="button" onClick={() => setDrawer(null)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Batal
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-green-700 disabled:opacity-50">
              {busy ? "Menyimpan..." : "Simpan Perubahan"}
            </button>
          </DrawerFooter>
        </form>
      </Drawer>

      <Drawer open={drawer === "add"} onClose={() => setDrawer(null)} title="Tambah Kontak Baru" subtitle="Nomor akan otomatis dinormalisasi ke format 628xxx">
        <form className="flex flex-1 flex-col overflow-hidden" onSubmit={saveContact}>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {drawerError && <FormError msg={drawerError} />}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                No. Telepon WhatsApp <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="08123456789 atau 628123456789"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>
            <FormInput label="Nama Pelanggan" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="mis. Siti Rahmawati" />
            <FormInput label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="email@contoh.com" />
            <TaxonomyPicker label="Kategori" rows={categories} selected={selCats} onToggle={(id) => setSelCats((l) => toggleIn(l, id))} />
            <TaxonomyPicker label="Tag" rows={tags} selected={selTags} onToggle={(id) => setSelTags((l) => toggleIn(l, id))} />
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Catatan Internal</label>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Catatan tambahan mengenai kontak ini..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>
          <DrawerFooter>
            <button type="button" onClick={() => setDrawer(null)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Batal
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-green-700 disabled:opacity-50">
              {busy ? "Menyimpan..." : "Simpan Kontak"}
            </button>
          </DrawerFooter>
        </form>
      </Drawer>

      <Drawer open={drawer === "import"} onClose={() => setDrawer(null)} title="Impor Kontak Massal" subtitle="Unggah daftar kontak dari berkas CSV atau Excel">
        <form className="flex flex-1 flex-col overflow-hidden" onSubmit={doImport}>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {drawerError && <FormError msg={drawerError} />}
            {importResult && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
                {importResult}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Berkas Excel / CSV</label>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setImportFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-slate-700 file:shadow-xs hover:file:bg-slate-100"
              />
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600">
                <p className="font-medium text-slate-700">Format header yang dikenali:</p>
                <p className="mt-1.5 leading-relaxed text-slate-500">
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">nomor / phone / no hp</code> (wajib),
                  <code className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">nama / name</code>,
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">email</code>,
                  <code className="mx-1 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700">catatan / notes</code>.
                </p>
                <p className="mt-2 text-[11px] text-slate-400">
                  Nomor duplikat otomatis dilewati. Maksimal 10.000 baris per unggahan.
                </p>
              </div>
            </div>
          </div>
          <DrawerFooter>
            <button type="button" onClick={() => setDrawer(null)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Tutup
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-green-700 disabled:opacity-50">
              {busy ? "Mengimpor..." : "Mulai Impor"}
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function FormError({ msg }: { msg: string }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
      {msg}
    </p>
  );
}

function FormInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{props.label}</label>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
      />
    </div>
  );
}

function TaxonomyPicker(props: {
  label: string;
  rows: Array<{ id: string; name: string; color: string | null }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700">{props.label}</label>
      <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
        {props.rows.length === 0 ? (
          <p className="px-1 py-1 text-xs text-slate-400">
            Belum ada - buat lewat kolom di bawah atau di halaman Tag.
          </p>
        ) : (
          props.rows.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs transition hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={props.selected.includes(r.id)}
                onChange={() => props.onToggle(r.id)}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-green-600"
              />
              <Chip name={r.name} color={r.color} />
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function Drawer(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/30"
      style={{ animation: "kontakFadeIn 0.15s ease-out" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <style>{`@keyframes kontakFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes kontakSlideIn { from { transform: translateX(24px) } to { transform: translateX(0) } }`}</style>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
        style={{ animation: "kontakSlideIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{props.title}</h3>
            {props.subtitle && <p className="font-mono text-xs text-slate-500">{props.subtitle}</p>}
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

export const getServerSideProps: GetServerSideProps = withAuth(async () => ({
  props: {},
}));
