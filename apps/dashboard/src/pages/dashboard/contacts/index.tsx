import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { Plus, Download, Upload } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, Contact, ListResult, Tag } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Select } from "@csq/ui/components/ui/select";
import { Textarea } from "@csq/ui/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { readableTextColor } from "@/lib/tag-color";

const PAGE_SIZE = 10;

// readAsDataURL yields "data:<mime>;base64,<payload>"; keep the payload only.
// (Same helper as the knowledge upload - kept local, two callers only.)
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// Chip for a taxonomy row (tag or category) with its color.
function TaxonomyChip({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={color ? { backgroundColor: color, color: readableTextColor(color) ?? undefined } : undefined}
    >
      {name}
    </span>
  );
}

// Checkbox list for one taxonomy (used in the edit dialog): toggling an id
// in the selected set. Tenant taxonomies are small, so a plain list is fine.
// OPS-3 (PRD 16): when onCreate is provided (OWNER), a small inline input
// creates a tag/category without leaving the editor.
function TaxonomyPicker({
  title,
  rows,
  selectedIds,
  onToggle,
  onCreate,
}: {
  title: string;
  rows: Array<{ id: string; name: string; color: string | null }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreate?: (name: string) => void;
}) {
  const [newName, setNewName] = useState("");
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{title}</Label>
      <div className="max-h-32 overflow-y-auto rounded-md border p-2">
        {rows.length === 0 && (
          <p className="px-1 py-0.5 text-xs text-muted-foreground">
            Belum ada - buat lewat kolom di bawah atau di halaman Tag.
          </p>
        )}
        {rows.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
            <input
              type="checkbox"
              checked={selectedIds.includes(r.id)}
              onChange={() => onToggle(r.id)}
              className="h-4 w-4"
            />
            <TaxonomyChip name={r.name} color={r.color} />
          </label>
        ))}
      </div>
      {onCreate && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            onCreate(name);
            setNewName("");
          }}
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nama baru..."
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" className="shrink-0">
            <Plus size={14} />
          </Button>
        </form>
      )}
    </div>
  );
}

export default function ContactsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isOwner = session?.user.role === "OWNER";
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  // Allow deep-linking with a pre-filled search via ?search=<term> (used by the
  // pipeline "Buka Kontak" action).
  useEffect(() => {
    const s = router.query.search;
    if (typeof s === "string" && s) {
      setSearch(s);
      setQuery(s);
      setPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.search]);

  const [editing, setEditing] = useState<Contact | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [editCategoryIds, setEditCategoryIds] = useState<string[]>([]);
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Tambah Kontak dialog (owner request 2026-11-18).
  const [adding, setAdding] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newCategoryIds, setNewCategoryIds] = useState<string[]>([]);
  const [newTagIds, setNewTagIds] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);

  // Impor Kontak dialog.
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  // Taxonomies for the filter bar and the edit dialog.
  const categories = useApi<Category[]>("/api/dashboard/contact-categories");
  const tags = useApi<ListResult<Tag>>("/api/dashboard/tags?pageSize=100");

  const url = `/api/dashboard/contacts?page=${page}&pageSize=${PAGE_SIZE}${
    search ? `&search=${encodeURIComponent(search)}` : ""
  }${categoryFilter ? `&categoryId=${categoryFilter}` : ""}${
    tagFilter ? `&tagId=${tagFilter}` : ""
  }`;
  const { data, loading, error, refresh } = useApi<ListResult<Contact>>(url);

  function applySearch(e: FormEvent) {
    e.preventDefault();
    setSearch(query);
    setPage(1);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setName(contact.name ?? "");
    setEmail(contact.email ?? "");
    setNotes(contact.notes ?? "");
    setEditCategoryIds((contact.categories ?? []).map((c) => c.categoryId));
    setEditTagIds((contact.tags ?? []).map((t) => t.tagId));
    setFormError(null);
  }

  function toggleId(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  // OPS-3 (PRD 16): inline taxonomy creation from the contact editor.
  async function createCategory(name: string) {
    try {
      const created = await apiSend<Category>(
        "/api/dashboard/contact-categories",
        "POST",
        { name }
      );
      categories.refresh();
      setEditCategoryIds((l) => (l.includes(created.id) ? l : [...l, created.id]));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat kategori.");
    }
  }

  async function createTag(name: string) {
    try {
      const created = await apiSend<Tag>("/api/dashboard/tags", "POST", { name });
      tags.refresh();
      setEditTagIds((l) => (l.includes(created.id) ? l : [...l, created.id]));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat tag.");
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiSend<Contact>(`/api/dashboard/contacts/${editing.id}`, "PUT", {
        name: name || undefined,
        email: email || undefined,
        notes: notes || undefined,
        categoryIds: editCategoryIds,
        tagIds: editTagIds,
      });
      setEditing(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan kontak.");
    } finally {
      setSaving(false);
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setAddError(null);
    try {
      await apiSend<Contact>("/api/dashboard/contacts", "POST", {
        phone: newPhone,
        ...(newName ? { name: newName } : {}),
        ...(newEmail ? { email: newEmail } : {}),
        ...(newNotes ? { notes: newNotes } : {}),
        categoryIds: newCategoryIds,
        tagIds: newTagIds,
      });
      setAdding(false);
      setNewPhone("");
      setNewName("");
      setNewEmail("");
      setNewNotes("");
      setNewCategoryIds([]);
      setNewTagIds([]);
      setPage(1);
      refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Gagal menambah kontak.");
    } finally {
      setSaving(false);
    }
  }

  async function onImport(e: FormEvent) {
    e.preventDefault();
    if (!importFile) return;
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const base64 = await fileToBase64(importFile);
      const result = await apiSend<{ created: number; skipped: number; errors: string[] }>(
        "/api/dashboard/contacts/import",
        "POST",
        { filename: importFile.name, base64 }
      );
      setImportResult(result);
      setImportFile(null);
      setPage(1);
      refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Gagal mengimpor kontak.");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <DashboardShell title="Kontak" description="Data pelanggan dari percakapan WhatsApp.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <form onSubmit={applySearch} className="flex flex-wrap gap-2">
          <Input
            placeholder="Cari nama atau nomor telepon…"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="max-w-[180px]"
          >
            <option value="">Semua kategori</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
              setPage(1);
            }}
            className="max-w-[180px]"
          >
            <option value="">Semua tag</option>
            {(tags.data?.items ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Cari
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {isOwner && (
            <Button size="sm" onClick={() => { setAdding(true); setAddError(null); }}>
              <Plus size={16} className="mr-1" /> Tambah
            </Button>
          )}
          {isOwner && (
            <Button size="sm" variant="outline" onClick={() => { setImporting(true); setImportError(null); setImportResult(null); }}>
              <Upload size={16} className="mr-1" /> Impor
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.href = "/api/dashboard/contacts/export";
            }}
          >
            <Download size={16} className="mr-1" /> Ekspor
          </Button>
        </div>
      </div>

      {loading && <StateNotice variant="loading" message="Memuat kontak…" />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>No. Telepon</TableHead>
                  <TableHead className="hidden md:table-cell">Kategori</TableHead>
                  <TableHead className="hidden lg:table-cell">Tag</TableHead>
                  <TableHead className="hidden xl:table-cell">Email</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <StateNotice variant="empty" message="Belum ada kontak." />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name ?? "-"}</TableCell>
                    <TableCell>{c.phoneDisplay ?? c.phone}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {(c.categories ?? []).length === 0 && (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {(c.categories ?? []).map((ct) => (
                          <TaxonomyChip
                            key={ct.id}
                            name={ct.category.name}
                            color={ct.category.color}
                          />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {(c.tags ?? []).length === 0 && (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {(c.tags ?? []).map((ct) => (
                          <TaxonomyChip key={ct.id} name={ct.tag.name} color={ct.tag.color} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground xl:table-cell">
                      {c.email ?? "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                        Edit
                      </Button>
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

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Kontak"
      >
        <form onSubmit={onSave} className="flex flex-col gap-4">
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-name">Nama</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@contoh.com"
            />
          </div>
          <TaxonomyPicker
            title="Kategori"
            rows={categories.data ?? []}
            selectedIds={editCategoryIds}
            onToggle={(id) => setEditCategoryIds((l) => toggleId(l, id))}
          />
          <TaxonomyPicker
            title="Tag"
            rows={tags.data?.items ?? []}
            selectedIds={editTagIds}
            onToggle={(id) => setEditTagIds((l) => toggleId(l, id))}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-notes">Catatan</Label>
            <Textarea
              id="contact-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Tambah Kontak"
      >
        <form onSubmit={onAdd} className="flex flex-col gap-4">
          {addError && <p className="text-sm text-destructive">{addError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-phone">No. Telepon *</Label>
            <Input
              id="add-phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="08123456789 atau 628123456789"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-name">Nama</Label>
            <Input
              id="add-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-email">Email</Label>
            <Input
              id="add-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="email@contoh.com"
            />
          </div>
          <TaxonomyPicker
            title="Kategori"
            rows={categories.data ?? []}
            selectedIds={newCategoryIds}
            onToggle={(id) => setNewCategoryIds((l) => toggleId(l, id))}
            onCreate={createCategory}
          />
          <TaxonomyPicker
            title="Tag"
            rows={tags.data?.items ?? []}
            selectedIds={newTagIds}
            onToggle={(id) => setNewTagIds((l) => toggleId(l, id))}
            onCreate={createTag}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-notes">Catatan</Label>
            <Textarea
              id="add-notes"
              rows={3}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={importing}
        onClose={() => setImporting(false)}
        title="Impor Kontak"
      >
        <form onSubmit={onImport} className="flex flex-col gap-4">
          {importError && <p className="text-sm text-destructive">{importError}</p>}
          {importResult && (
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              <p>
                <span className="font-medium">{importResult.created}</span> kontak ditambahkan
                {importResult.skipped > 0 && (
                  <>, <span className="font-medium">{importResult.skipped}</span> dilewati (duplikat atau tidak valid)</>
                )}.</p>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-file">Berkas Excel/CSV</Label>
            <Input
              id="import-file"
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Kolom yang dikenali (header): nomor / phone / no hp (wajib), nama / name, email, catatan / notes.
              Nomor duplikat dilewati. Maksimal 10.000 baris.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setImporting(false)}>
              Tutup
            </Button>
            <Button type="submit" disabled={!importFile || importBusy}>
              {importBusy ? "Mengimpor…" : "Impor"}
            </Button>
          </div>
        </form>
      </Dialog>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
