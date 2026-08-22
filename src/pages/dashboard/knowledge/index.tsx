import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Knowledge, KnowledgeType, ListResult } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PAGE_SIZE = 10;

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Semua jenis" },
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

// Narrow a string from a <select> to KnowledgeType without `as` — fall back to
// FAQ if the value is somehow not a known type.
function toKnowledgeType(v: string): KnowledgeType {
  return TYPE_VALUES.find((t) => t === v) ?? "FAQ";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function KnowledgePage() {
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState<KnowledgeType>("FAQ");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Inline edit + delete state (same pattern as Products).
  const [editing, setEditing] = useState<Knowledge | null>(null);
  const [editType, setEditType] = useState<KnowledgeType>("FAQ");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<Knowledge | null>(null);
  const [deleting, setDeleting] = useState(false);

  const url = `/api/dashboard/knowledge?page=${page}&pageSize=${PAGE_SIZE}${
    typeFilter ? `&type=${typeFilter}` : ""
  }`;
  const { data, loading, error, refresh } = useApi<ListResult<Knowledge>>(url);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await apiSend<Knowledge>("/api/dashboard/knowledge/create", "POST", {
        type,
        title,
        content,
      });
      setCreateOpen(false);
      setTitle("");
      setContent("");
      setType("FAQ");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menambah pengetahuan.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(k: Knowledge) {
    setEditing(k);
    setEditType(k.type);
    setEditTitle(k.title);
    setEditContent(k.content);
    setEditError(null);
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await apiSend<Knowledge>(`/api/dashboard/knowledge/${editing.id}`, "PUT", {
        type: editType,
        title: editTitle,
        content: editContent,
      });
      setEditing(null);
      refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Gagal menyimpan pengetahuan.");
    } finally {
      setEditSaving(false);
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
      setEditError(err instanceof Error ? err.message : "Gagal menghapus pengetahuan.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DashboardShell
      title="Pengetahuan"
      description="FAQ, kebijakan, dan info usaha untuk agen."
      actions={<Button onClick={() => setCreateOpen(true)}>Tambah Pengetahuan</Button>}
    >
      <div className="mb-4 flex items-center gap-2">
        <Label htmlFor="knowledge-type-filter" className="sr-only">
          Filter jenis
        </Label>
        <Select
          id="knowledge-type-filter"
          value={typeFilter}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {loading && <StateNotice variant="loading" message="Memuat pengetahuan…" />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Judul</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Diperbarui</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <StateNotice variant="empty" message="Belum ada pengetahuan." />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.title}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{TYPE_LABEL[k.type]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(k.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(k)}>
                          Edit
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setToDelete(k)}>
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah Pengetahuan"
      >
        <form onSubmit={onCreate} className="flex flex-col gap-4">
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-type">Jenis</Label>
            <Select
              id="knowledge-type"
              value={type}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setType(toKnowledgeType(e.target.value))
              }
            >
              <option value="FAQ">FAQ</option>
              <option value="POLICY">Kebijakan</option>
              <option value="BUSINESS_INFO">Info Usaha</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-title">Judul</Label>
            <Input
              id="knowledge-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-content">Isi</Label>
            <Textarea
              id="knowledge-content"
              required
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
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

      {/* Inline edit dialog */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit Pengetahuan"
      >
        <form onSubmit={onSaveEdit} className="flex flex-col gap-4">
          {editError && <p className="text-sm text-destructive">{editError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-knowledge-type">Jenis</Label>
            <Select
              id="edit-knowledge-type"
              value={editType}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setEditType(toKnowledgeType(e.target.value))
              }
            >
              <option value="FAQ">FAQ</option>
              <option value="POLICY">Kebijakan</option>
              <option value="BUSINESS_INFO">Info Usaha</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-knowledge-title">Judul</Label>
            <Input
              id="edit-knowledge-title"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-knowledge-content">Isi</Label>
            <Textarea
              id="edit-knowledge-content"
              required
              rows={6}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Batal
            </Button>
            <Button type="submit" disabled={editSaving}>
              {editSaving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Pengetahuan"
        description={`Yakin ingin menghapus "${toDelete?.title}"? Tindakan ini tidak dapat dibatalkan.`}
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
