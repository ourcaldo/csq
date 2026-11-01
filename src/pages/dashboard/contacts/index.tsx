import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, Contact, ListResult, Tag } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { readableTextColor } from "@/lib/tag-color";

const PAGE_SIZE = 10;

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
function TaxonomyPicker({
  title,
  rows,
  selectedIds,
  onToggle,
}: {
  title: string;
  rows: Array<{ id: string; name: string; color: string | null }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{title}</Label>
      <div className="max-h-32 overflow-y-auto rounded-md border p-2">
        {rows.length === 0 && (
          <p className="px-1 py-0.5 text-xs text-muted-foreground">
            Belum ada — buat dulu di halaman Tag.
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
    </div>
  );
}

export default function ContactsPage() {
  const router = useRouter();
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

  return (
    <DashboardShell title="Kontak" description="Data pelanggan dari percakapan WhatsApp.">
      <form onSubmit={applySearch} className="mb-4 flex flex-wrap gap-2">
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
                    <TableCell className="font-medium">{c.name ?? "—"}</TableCell>
                    <TableCell>{c.phoneDisplay ?? c.phone}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {(c.categories ?? []).length === 0 && (
                          <span className="text-muted-foreground">—</span>
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
                          <span className="text-muted-foreground">—</span>
                        )}
                        {(c.tags ?? []).map((ct) => (
                          <TaxonomyChip key={ct.id} name={ct.tag.name} color={ct.tag.color} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground xl:table-cell">
                      {c.email ?? "—"}
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
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
