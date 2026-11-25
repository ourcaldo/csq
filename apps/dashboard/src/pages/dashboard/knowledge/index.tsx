// Pengetahuan page (PRD 31): grouped entries (FAQ = multiple Q&A pairs),
// kategori, stat strip, search/chips/sort, and full-page composer views.
// Owner UI rules 2026-11-23: entity editing is a full page, not a modal.
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import type { GetServerSideProps } from "next";
import {
  ArrowLeft,
  Books,
  Check,
  FileText,
  Info,
  Lightbulb,
  MagicWand,
  Plus,
  Question,
  Scroll,
  Storefront,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { KNOWLEDGE_CATEGORIES } from "@csq/core/types/knowledge";
import type { KnowledgeCategory } from "@csq/core/types/knowledge";
import type {
  KnowledgeGroup,
  KnowledgeStats,
  KnowledgeType,
  ListResult,
} from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Textarea } from "@csq/ui/components/ui/textarea";
import { Select } from "@csq/ui/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { cn } from "@csq/ui/lib/utils";

const PAGE_SIZE = 10;

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Semua" },
  { value: "FAQ", label: "FAQ" },
  { value: "POLICY", label: "Kebijakan" },
  { value: "BUSINESS_INFO", label: "Info Usaha" },
];

const TYPE_LABEL: Record<KnowledgeType, string> = {
  FAQ: "FAQ",
  POLICY: "Kebijakan",
  BUSINESS_INFO: "Info Usaha",
};

const TYPE_VALUES: KnowledgeType[] = ["FAQ", "POLICY", "BUSINESS_INFO"];

// Narrow a string from a <select> to KnowledgeType without `as` - fall back to
// FAQ if the value is somehow not a known type.
function toKnowledgeType(v: string): KnowledgeType {
  return TYPE_VALUES.find((t) => t === v) ?? "FAQ";
}

function toCategory(v: string): KnowledgeCategory {
  return KNOWLEDGE_CATEGORIES.find((c) => c === v) ?? "Umum";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// readAsDataURL yields "data:<mime>;base64,<payload>"; keep the payload only.
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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type KnowledgeListResult = ListResult<KnowledgeGroup> & { stats: KnowledgeStats };

type PairDraft = { q: string; a: string };

export default function KnowledgePage() {
  const [view, setView] = useState<"list" | "editor" | "upload">("list");

  // List filters
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("updated");

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const url = `/api/dashboard/knowledge?page=${page}&pageSize=${PAGE_SIZE}${
    typeFilter ? `&type=${typeFilter}` : ""
  }${q ? `&q=${encodeURIComponent(q)}` : ""}&sort=${sort}`;
  const { data, loading, error, refresh } = useApi<KnowledgeListResult>(url);

  // Editor state
  const [editing, setEditing] = useState<KnowledgeGroup | null>(null);
  const [type, setType] = useState<KnowledgeType>("FAQ");
  const [category, setCategory] = useState<KnowledgeCategory>("Umum");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pairs, setPairs] = useState<PairDraft[]>([{ q: "", a: "" }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<KnowledgeGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditing(null);
    setType("FAQ");
    setCategory("Umum");
    setTitle("");
    setContent("");
    setPairs([{ q: "", a: "" }]);
    setFormError(null);
    setView("editor");
  }

  function openEdit(group: KnowledgeGroup) {
    setEditing(group);
    setType(group.type);
    setCategory(toCategory(group.category ?? "Umum"));
    setTitle(group.title);
    setContent(group.pairs[0]?.a ?? "");
    setPairs(
      group.type === "FAQ" && group.pairs.length > 0
        ? group.pairs.map((p) => ({ q: p.q, a: p.a }))
        : [{ q: "", a: "" }]
    );
    setFormError(null);
    setView("editor");
  }

  function openUpload() {
    setUploadFile(null);
    setUploadTitle("");
    setUploadError(null);
    setView("upload");
  }

  function updatePair(index: number, patch: Partial<PairDraft>) {
    setPairs((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function addPair() {
    setPairs((prev) => (prev.length >= 20 ? prev : [...prev, { q: "", a: "" }]));
  }

  function removePair(index: number) {
    setPairs((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);

    let body: unknown;
    if (type === "FAQ") {
      const clean = pairs.map((p) => ({ q: p.q.trim(), a: p.a.trim() }));
      const incomplete = clean.findIndex((p) => !p.q || !p.a);
      if (incomplete !== -1) {
        setFormError(`Lengkapi pertanyaan dan jawaban di Q&A #${incomplete + 1}.`);
        return;
      }
      body = { type: "FAQ", category, pairs: clean };
    } else {
      if (!title.trim() || !content.trim()) {
        setFormError("Isi judul dan isi terlebih dahulu.");
        return;
      }
      body = { type, title: title.trim(), content: content.trim(), category };
    }

    setSaving(true);
    try {
      if (editing) {
        await apiSend<KnowledgeGroup>(`/api/dashboard/knowledge/${editing.id}`, "PUT", body);
      } else {
        await apiSend<KnowledgeGroup>("/api/dashboard/knowledge/create", "POST", body);
      }
      setView("list");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan pengetahuan.");
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (uploading) return;
    if (!uploadFile) {
      setUploadError("Pilih berkas PDF atau DOCX.");
      return;
    }
    if (uploadFile.size > MAX_UPLOAD_BYTES) {
      setUploadError("Dokumen maksimal 10 MB.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const base64 = await fileToBase64(uploadFile);
      await apiSend("/api/dashboard/knowledge/upload", "POST", {
        filename: uploadFile.name,
        base64,
        ...(uploadTitle.trim() ? { title: uploadTitle.trim() } : {}),
      });
      setView("list");
      refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Gagal mengunggah dokumen.");
    } finally {
      setUploading(false);
    }
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await apiSend(`/api/dashboard/knowledge/${toDelete.id}`, "DELETE");
      setToDelete(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus pengetahuan.");
    } finally {
      setDeleting(false);
    }
  }

  const stats = data?.stats ?? { total: 0, FAQ: 0, POLICY: 0, BUSINESS_INFO: 0 };

  return (
    <DashboardShell
      title={
        view === "list" ? "Pengetahuan" : view === "editor" ? (editing ? "Edit Pengetahuan" : "Tambah Pengetahuan") : "Unggah Dokumen"
      }
      description={
        view === "list"
          ? "FAQ, kebijakan, dan info usaha yang dipakai agen saat menjawab pelanggan."
          : view === "editor"
            ? "Tulis satu topik per entri agar agen mudah menemukan jawaban yang tepat."
            : "PDF atau DOCX. Teks diekstrak otomatis dan langsung bisa dicari agen."
      }
      actions={
        view === "list" ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openUpload}>
              <UploadSimple size={16} className="mr-1.5" /> Unggah Dokumen
            </Button>
            <Button onClick={openCreate}>
              <Plus size={16} className="mr-1.5" /> Tambah Pengetahuan
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setView("list")}>
            <ArrowLeft size={16} className="mr-1.5" /> Kembali
          </Button>
        )
      }
    >
      {view === "list" && (
        <>
          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Total entri" hint="Semua jenis pengetahuan" value={stats.total} icon={<Books size={18} className="text-slate-300" />} />
            <StatTile label="FAQ" hint="Pertanyaan yang sering ditanya" value={stats.FAQ} icon={<Question size={18} className="text-green-500" />} />
            <StatTile label="Kebijakan" hint="Aturan retur, kirim, garansi" value={stats.POLICY} icon={<Scroll size={18} className="text-amber-500" />} />
            <StatTile label="Info usaha" hint="Jam buka, alamat, pembayaran" value={stats.BUSINESS_INFO} icon={<Storefront size={18} className="text-blue-500" />} />
          </div>

          {/* Toolbar */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 md:max-w-sm">
              <Label htmlFor="knowledge-search" className="sr-only">
                Cari pengetahuan
              </Label>
              <Input
                id="knowledge-search"
                type="search"
                value={search}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                placeholder="Cari judul atau isi pengetahuan..."
                className="pl-3"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter jenis">
              {TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    setTypeFilter(o.value);
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    typeFilter === o.value
                      ? "border-green-700 bg-green-700 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="ml-auto">
              <Label htmlFor="knowledge-sort" className="sr-only">
                Urutkan
              </Label>
              <Select
                id="knowledge-sort"
                value={sort}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                className="h-9 w-auto text-xs"
              >
                <option value="updated">Terbaru diperbarui</option>
                <option value="title">Judul A-Z</option>
                <option value="type">Jenis</option>
              </Select>
            </div>
          </div>

          {loading && <StateNotice variant="loading" message="Memuat pengetahuan..." className="mt-3" />}
          {error && <StateNotice variant="error" message={error} className="mt-3" />}
          {!loading && !error && (
            <>
              <div className="mt-3 rounded-lg border bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Judul</TableHead>
                      <TableHead>Jenis</TableHead>
                      <TableHead className="hidden md:table-cell">Kategori</TableHead>
                      <TableHead className="hidden sm:table-cell">Sumber</TableHead>
                      <TableHead className="hidden lg:table-cell">Diperbarui</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data && data.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <StateNotice
                            variant="empty"
                            message={
                              q || typeFilter
                                ? "Tidak ada pengetahuan yang cocok dengan filter."
                                : "Belum ada pengetahuan. Tambahkan FAQ, kebijakan, atau unggah dokumen."
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )}
                    {data?.items.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col gap-0.5">
                            <span>{g.title}</span>
                            <span className="line-clamp-1 max-w-xl text-xs font-normal text-muted-foreground">
                              {g.preview}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <TypeBadge type={g.type} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            {g.category ?? "Umum"}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {g.sourceName ? (
                            <span className="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
                              <FileText size={12} />
                              <span className="truncate">{g.sourceName}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Manual</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">
                          {formatDate(g.updatedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(g)}>
                              Edit
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => setToDelete(g)}>
                              Hapus
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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

          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
            Pengetahuan dicari agen sesuai kebutuhan percakapan, bukan dimuat sekaligus ke prompt.
          </p>
        </>
      )}

      {view === "editor" && (
        <form onSubmit={onSave} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border bg-white lg:col-span-2">
            <div className="space-y-5 p-5">
              {formError && <p className="text-sm text-destructive">{formError}</p>}

              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-900">Jenis pengetahuan</span>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Jenis pengetahuan">
                  {TYPE_VALUES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={type === t}
                      onClick={() => setType(t)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-xs transition-colors",
                        type === t
                          ? "border-green-600 bg-green-50 font-semibold text-green-700"
                          : "border-slate-200 bg-white font-medium text-slate-600 hover:border-slate-300"
                      )}
                    >
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="knowledge-category" className="mb-1.5 block text-xs font-semibold">
                  Kategori
                </Label>
                <Select
                  id="knowledge-category"
                  value={category}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setCategory(toCategory(e.target.value))}
                >
                  {KNOWLEDGE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Kategori memudahkan pencarian dan pengelompokan di daftar.
                </p>
              </div>

              {type === "FAQ" ? (
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">Daftar pertanyaan &amp; jawaban</span>
                    <Button type="button" variant="outline" size="sm" onClick={addPair} disabled={pairs.length >= 20}>
                      <Plus size={14} className="mr-1" /> Tambah Q&amp;A
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Satu entri FAQ bisa memuat beberapa pertanyaan yang saling terkait. Minimal satu pasangan, maksimal 20.
                  </p>
                  <div className="mt-3 space-y-3">
                    {pairs.map((pair, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Q&amp;A #{i + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removePair(i)}
                            disabled={pairs.length <= 1}
                            aria-label="Hapus Q&A"
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash size={14} />
                          </button>
                        </div>
                        <Label htmlFor={`qa-q-${i}`} className="mb-1 block text-[11px] font-semibold text-slate-600">
                          Pertanyaan
                        </Label>
                        <Input
                          id={`qa-q-${i}`}
                          value={pair.q}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updatePair(i, { q: e.target.value })}
                          placeholder="Contoh: Berapa lama pengiriman?"
                        />
                        <Label htmlFor={`qa-a-${i}`} className="mb-1 mt-3 block text-[11px] font-semibold text-slate-600">
                          Jawaban
                        </Label>
                        <Textarea
                          id={`qa-a-${i}`}
                          rows={2}
                          value={pair.a}
                          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updatePair(i, { a: e.target.value })}
                          placeholder="Jawab singkat dan spesifik..."
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="knowledge-title" className="mb-1.5 block text-xs font-semibold">
                      Judul
                    </Label>
                    <Input
                      id="knowledge-title"
                      value={title}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                      placeholder="Contoh: Kebijakan retur dan penukaran"
                    />
                  </div>
                  <div>
                    <Label htmlFor="knowledge-content" className="mb-1.5 block text-xs font-semibold">
                      Isi
                    </Label>
                    <Textarea
                      id="knowledge-content"
                      rows={8}
                      value={content}
                      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
                      placeholder="Tulis isi lengkap, termasuk angka, syarat, dan pengecualian..."
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Agen mengutip isi ini apa adanya. Sebutkan sumber harga atau kebijakan bila ada.
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
              <Button type="button" variant="outline" onClick={() => setView("list")}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Menyimpan..." : "Simpan Pengetahuan"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border bg-white p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <MagicWand size={14} className="text-green-600" /> Cara agen memakai entri ini
              </p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                <li className="flex gap-1.5">
                  <Check size={14} className="mt-0.5 shrink-0 text-green-600" /> Dicari saat pelanggan bertanya hal yang mirip.
                </li>
                <li className="flex gap-1.5">
                  <Check size={14} className="mt-0.5 shrink-0 text-green-600" /> Jawaban tetap dalam batas izin dan kebijakan Anda.
                </li>
                <li className="flex gap-1.5">
                  <Check size={14} className="mt-0.5 shrink-0 text-green-600" /> Bila tidak yakin, agen mengalihkan ke staf, tidak mengarang.
                </li>
              </ul>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <Lightbulb size={14} /> Tips menulis
              </p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-amber-800/90">
                <li>Satu topik per entri, judul singkat dan spesifik.</li>
                <li>Tulis angka dan satuan dengan jelas (Rp, hari, jam).</li>
                <li>Perbarui saat harga atau kebijakan berubah.</li>
              </ul>
            </div>
          </div>
        </form>
      )}

      {view === "upload" && (
        <form onSubmit={onUpload} className="max-w-3xl">
          <div className="rounded-xl border bg-white">
            <div className="space-y-5 p-5">
              {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
              <div>
                <Label htmlFor="knowledge-file" className="mb-1.5 block text-xs font-semibold">
                  Berkas
                </Label>
                <label
                  htmlFor="knowledge-file"
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center transition-colors hover:border-green-500 hover:bg-green-50/40"
                >
                  <UploadSimple size={30} className="text-slate-400" />
                  <span className="mt-2 text-sm font-medium text-slate-700">
                    {uploadFile ? uploadFile.name : "Pilih berkas PDF atau DOCX"}
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">Maksimal 10 MB, teks diekstrak otomatis</span>
                  <input
                    id="knowledge-file"
                    type="file"
                    accept=".pdf,.docx"
                    className="sr-only"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setUploadFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <div>
                <Label htmlFor="knowledge-upload-title" className="mb-1.5 block text-xs font-semibold">
                  Judul (opsional)
                </Label>
                <Input
                  id="knowledge-upload-title"
                  value={uploadTitle}
                  placeholder="Kosongkan untuk memakai nama berkas"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setUploadTitle(e.target.value)}
                />
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="flex items-start gap-1.5">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  Setelah diunggah, dokumen dipecah menjadi potongan kecil dan diberi indeks agar agen bisa
                  mengutip bagian yang relevan saat menjawab.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
              <Button type="button" variant="outline" onClick={() => setView("list")}>
                Batal
              </Button>
              <Button type="submit" disabled={uploading}>
                {uploading ? "Mengunggah..." : "Unggah Dokumen"}
              </Button>
            </div>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Pengetahuan"
        description={
          toDelete?.type === "FAQ"
            ? `Yakin ingin menghapus "${toDelete?.title}" beserta ${toDelete?.pairCount} pasangan Q&A? Tindakan ini tidak dapat dibatalkan.`
            : `Yakin ingin menghapus "${toDelete?.title}"? Tindakan ini tidak dapat dibatalkan.`
        }
        confirmLabel="Hapus"
        destructive
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </DashboardShell>
  );
}

function StatTile({
  label,
  hint,
  value,
  icon,
}: {
  label: string;
  hint: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function TypeBadge({ type }: { type: KnowledgeType }) {
  const style =
    type === "FAQ"
      ? "border-green-200 bg-green-50 text-green-700"
      : type === "POLICY"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-blue-200 bg-blue-50 text-blue-700";
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium", style)}>
      {TYPE_LABEL[type]}
    </span>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} }),
  // SEC-3 (PRD 16): configuration pages are OWNER-only (PRD 15.9).
  { requiredPermission: "pengetahuan.kelola" }
);
