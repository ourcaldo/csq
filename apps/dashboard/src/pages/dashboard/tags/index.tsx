import { useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, ListResult, Tag } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { readableTextColor } from "@/lib/tag-color";

const PAGE_SIZE = 20;

function ChipCell({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
      style={color ? { backgroundColor: color, color: readableTextColor(color) ?? undefined } : undefined}
    >
      {name}
    </span>
  );
}

export default function TagsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  // ── Conversation tags ──
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameColor, setRenameColor] = useState("");

  const [toDelete, setToDelete] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState(false);

  const url = `/api/dashboard/tags?page=${page}&pageSize=${PAGE_SIZE}`;
  const { data, loading, error, refresh } = useApi<ListResult<Tag>>(url);

  // ── Contact categories (feature plan 2026-11-01, section 2.5) ──
  const [catCreateOpen, setCatCreateOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState("");
  const [catSaving, setCatSaving] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);

  const [catRenaming, setCatRenaming] = useState<Category | null>(null);
  const [catRenameName, setCatRenameName] = useState("");
  const [catRenameColor, setCatRenameColor] = useState("");

  const [catToDelete, setCatToDelete] = useState<Category | null>(null);
  const [catDeleting, setCatDeleting] = useState(false);

  const categories = useApi<Category[]>("/api/dashboard/contact-categories");

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await apiSend<Tag>("/api/dashboard/tags", "POST", {
        name,
        color: color || undefined,
      });
      setCreateOpen(false);
      setName("");
      setColor("");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat tag.");
    } finally {
      setSaving(false);
    }
  }

  function openRename(tag: Tag) {
    setRenaming(tag);
    setRenameName(tag.name);
    setRenameColor(tag.color ?? "");
    setFormError(null);
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiSend<Tag>(`/api/dashboard/tags/${renaming.id}`, "PUT", {
        name: renameName,
        color: renameColor || undefined,
      });
      setRenaming(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengubah tag.");
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await apiSend(`/api/dashboard/tags/${toDelete.id}`, "DELETE");
      setToDelete(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus tag.");
    } finally {
      setDeleting(false);
    }
  }

  async function onCategoryCreate(e: FormEvent) {
    e.preventDefault();
    setCatSaving(true);
    setCatError(null);
    try {
      await apiSend("/api/dashboard/contact-categories", "POST", {
        name: catName,
        color: catColor || undefined,
      });
      setCatCreateOpen(false);
      setCatName("");
      setCatColor("");
      categories.refresh();
    } catch (err) {
      setCatError(err instanceof Error ? err.message : "Gagal membuat kategori.");
    } finally {
      setCatSaving(false);
    }
  }

  async function onCategoryRename(e: FormEvent) {
    e.preventDefault();
    if (!catRenaming) return;
    setCatSaving(true);
    setCatError(null);
    try {
      await apiSend(`/api/dashboard/contact-categories/${catRenaming.id}`, "PUT", {
        name: catRenameName,
        color: catRenameColor || undefined,
      });
      setCatRenaming(null);
      categories.refresh();
    } catch (err) {
      setCatError(err instanceof Error ? err.message : "Gagal mengubah kategori.");
    } finally {
      setCatSaving(false);
    }
  }

  async function onCategoryDelete() {
    if (!catToDelete) return;
    setCatDeleting(true);
    try {
      await apiSend(`/api/dashboard/contact-categories/${catToDelete.id}`, "DELETE");
      setCatToDelete(null);
      categories.refresh();
    } catch (err) {
      setCatError(err instanceof Error ? err.message : "Gagal menghapus kategori.");
    } finally {
      setCatDeleting(false);
    }
  }

  return (
    <DashboardShell title="Tag" description="Taksonomi untuk melabeli percakapan dan mengelompokkan kontak.">
      {!isOwner && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Hanya owner yang dapat membuat, mengubah, atau menghapus tag dan kategori.
        </p>
      )}

      {formError && <p className="mb-4 text-sm text-destructive">{formError}</p>}
      {loading && <StateNotice variant="loading" message="Memuat tag…" />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Tag Percakapan
            </h2>
            {isOwner ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                Tambah Tag
              </Button>
            ) : undefined}
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Warna</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <StateNotice variant="empty" message="Belum ada tag." />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <ChipCell name={t.name} color={t.color} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-black/10"
                          style={{ backgroundColor: t.color ?? "#cbd5e1" }}
                          aria-hidden
                        />
                        <span className="font-mono text-[11px]">{t.color ?? "-"}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {isOwner ? (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openRename(t)}>
                            Ubah Nama
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => setToDelete(t)}>
                            Hapus
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
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

      {/* Kategori kontak */}
      <div className="mt-10">
        {catError && <p className="mb-4 text-sm text-destructive">{catError}</p>}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Kategori Kontak
          </h2>
          {isOwner ? (
            <Button size="sm" onClick={() => setCatCreateOpen(true)}>
              Tambah Kategori
            </Button>
          ) : undefined}
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Warna</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(categories.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <StateNotice
                      variant="empty"
                      message="Belum ada kategori. Kategori dipakai untuk mengelompokkan kontak dan menjadi target kampanye."
                    />
                  </TableCell>
                </TableRow>
              )}
              {(categories.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <ChipCell name={c.name} color={c.color} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-black/10"
                        style={{ backgroundColor: c.color ?? "#cbd5e1" }}
                        aria-hidden
                      />
                      <span className="font-mono text-[11px]">{c.color ?? "-"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {isOwner ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setCatRenaming(c);
                            setCatRenameName(c.name);
                            setCatRenameColor(c.color ?? "");
                          }}
                        >
                          Ubah Nama
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setCatToDelete(c)}>
                          Hapus
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Tag dialogs */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Tambah Tag">
        <form onSubmit={onCreate} className="flex flex-col gap-4">
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-name">Nama</Label>
            <Input
              id="tag-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-color">Warna (opsional)</Label>
            <Input
              id="tag-color"
              placeholder="mis. #ef4444 - kosongkan untuk acak"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              pattern="^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})?$"
              title="Kode hex, contoh: #ef4444 atau #fff"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title="Ubah Tag">
        <form onSubmit={onRename} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-rename-name">Nama</Label>
            <Input
              id="tag-rename-name"
              required
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-rename-color">Warna (opsional)</Label>
            <Input
              id="tag-rename-color"
              value={renameColor}
              onChange={(e) => setRenameColor(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Category dialogs */}
      <Dialog open={catCreateOpen} onClose={() => setCatCreateOpen(false)} title="Tambah Kategori">
        <form onSubmit={onCategoryCreate} className="flex flex-col gap-4">
          {catError && <p className="text-sm text-destructive">{catError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-name">Nama</Label>
            <Input
              id="category-name"
              required
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="mis. Reseller, Grosir, VIP"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-color">Warna (opsional)</Label>
            <Input
              id="category-color"
              placeholder="mis. #22c55e - kosongkan untuk acak"
              value={catColor}
              onChange={(e) => setCatColor(e.target.value)}
              pattern="^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})?$"
              title="Kode hex, contoh: #22c55e atau #fff"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCatCreateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={catSaving}>
              {catSaving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={catRenaming !== null} onClose={() => setCatRenaming(null)} title="Ubah Kategori">
        <form onSubmit={onCategoryRename} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-rename-name">Nama</Label>
            <Input
              id="category-rename-name"
              required
              value={catRenameName}
              onChange={(e) => setCatRenameName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-rename-color">Warna (opsional)</Label>
            <Input
              id="category-rename-color"
              value={catRenameColor}
              onChange={(e) => setCatRenameColor(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCatRenaming(null)}>
              Batal
            </Button>
            <Button type="submit" disabled={catSaving}>
              {catSaving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Tag"
        description={`Yakin ingin menghapus tag "${toDelete?.name}"?`}
        confirmLabel="Hapus"
        destructive
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setToDelete(null)}
      />

      <ConfirmDialog
        open={catToDelete !== null}
        title="Hapus Kategori"
        description={`Yakin ingin menghapus kategori "${catToDelete?.name}"? Kontak di dalamnya tidak ikut terhapus, hanya dilepas dari kategori ini.`}
        confirmLabel="Hapus"
        destructive
        loading={catDeleting}
        onConfirm={onCategoryDelete}
        onCancel={() => setCatToDelete(null)}
      />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
