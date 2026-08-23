import { useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult, Tag } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { readableTextColor } from "@/lib/tag-color";

const PAGE_SIZE = 20;

export default function TagsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

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

  return (
    <DashboardShell
      title="Tag"
      description="Taksonomi untuk melabeli percakapan."
      actions={
        isOwner ? (
          <Button onClick={() => setCreateOpen(true)}>Tambah Tag</Button>
        ) : undefined
      }
    >
      {!isOwner && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Hanya owner yang dapat membuat, mengubah, atau menghapus tag.
        </p>
      )}

      {formError && <p className="mb-4 text-sm text-destructive">{formError}</p>}
      {loading && <StateNotice variant="loading" message="Memuat tag…" />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && (
        <>
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
                      <span
                        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
                        style={
                          t.color
                            ? { backgroundColor: t.color, color: readableTextColor(t.color) ?? undefined }
                            : undefined
                        }
                      >
                        {t.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-black/10"
                          style={{ backgroundColor: t.color ?? "#cbd5e1" }}
                          aria-hidden
                        />
                        <span className="font-mono text-[11px]">{t.color ?? "—"}</span>
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
                        <span className="text-muted-foreground">—</span>
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
              placeholder="mis. #ef4444 — kosongkan untuk acak"
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
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
