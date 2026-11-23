// /dashboard/tags - enterprise taxonomy workspace revamp (template
// 2026-11-22): sub-navigation tabs (Tag Percakapan / Kategori Kontak),
// inline quick-add bars, and INLINE row editing (no pop-up modal except the
// destructive delete confirm).
import { useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { Plus } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, ListResult, Tag } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { FlushPage } from "@/components/dashboard/flush-page";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Toast } from "@/components/dashboard/channels/toast";
import type { ToastState } from "@/components/dashboard/channels/types";
import { readableTextColor } from "@/lib/tag-color";

const PAGE_SIZE = 50;

function Chip({ name, color }: { name: string; color: string | null }) {
  const text = readableTextColor(color);
  return (
    <span
      className="inline-flex items-center rounded px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: color ?? "#e2e8f0", color: text ?? "#1e293b" }}
    >
      {name}
    </span>
  );
}

type TaxKind = "TAG" | "CATEGORY";

export default function TagsPage() {
  const { data: session } = useSession();
  const canManage = !!session?.user?.isOwner || !!session?.user?.permissions?.includes("tag.kelola");

  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"tags" | "categories">("tags");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast({ tone: "success", msg });
    setTimeout(() => setToast(null), 2600);
  }

  const tagsUrl = `/api/dashboard/tags?page=${page}&pageSize=${PAGE_SIZE}`;
  const tags = useApi<ListResult<Tag>>(tagsUrl);
  const categories = useApi<Category[]>("/api/dashboard/contact-categories");

  // Quick-add state.
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#dcfce7");
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState("#dbeafe");
  const [adding, setAdding] = useState(false);

  // Inline rename state: the row being edited.
  const [editing, setEditing] = useState<{ kind: TaxKind; id: string; name: string; color: string } | null>(null);

  // Destructive delete.
  const [toDelete, setToDelete] = useState<{ kind: TaxKind; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function quickAdd(kind: TaxKind, e: FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      if (kind === "TAG") {
        const name = tagName.trim();
        if (!name) return;
        await apiSend<Tag>("/api/dashboard/tags", "POST", { name, color: tagColor });
        setTagName("");
        showToast(`Tag "${name}" ditambahkan`);
        tags.refresh();
      } else {
        const name = catName.trim();
        if (!name) return;
        await apiSend("/api/dashboard/contact-categories", "POST", { name, color: catColor });
        setCatName("");
        showToast(`Kategori "${name}" ditambahkan`);
        categories.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambahkan item.");
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setAdding(true);
    setError(null);
    try {
      const payload = { name: editing.name, color: editing.color };
      if (editing.kind === "TAG") {
        await apiSend<Tag>(`/api/dashboard/tags/${editing.id}`, "PUT", payload);
        tags.refresh();
      } else {
        await apiSend<Category>(`/api/dashboard/contact-categories/${editing.id}`, "PUT", payload);
        categories.refresh();
      }
      setEditing(null);
      showToast("Perubahan label disimpan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan perubahan.");
    } finally {
      setAdding(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setError(null);
    try {
      if (toDelete.kind === "TAG") {
        await apiSend(`/api/dashboard/tags/${toDelete.id}`, "DELETE");
        tags.refresh();
      } else {
        await apiSend(`/api/dashboard/contact-categories/${toDelete.id}`, "DELETE");
        categories.refresh();
      }
      setToDelete(null);
      showToast("Item dihapus");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus item.");
    } finally {
      setDeleting(false);
    }
  }

  function taxonomyRows(kind: TaxKind) {
    const items: { id: string; name: string; color: string | null }[] =
      kind === "TAG" ? (tags.data?.items ?? []) : (categories.data ?? []);
    const usageText = kind === "TAG" ? "percakapan" : "kontak";
    return items.map((item) => {
      const isEditing = editing?.kind === kind && editing.id === item.id;
      if (isEditing) {
        return (
          <tr key={item.id} className="bg-slate-50/80">
            <td className="py-3 pr-4">
              <input
                type="text"
                value={editing.name}
                maxLength={32}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="h-8 w-56 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-green-600 focus:outline-none"
              />
            </td>
            <td className="px-4 py-3">
              <input
                type="color"
                value={editing.color}
                onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
              />
            </td>
            <td className="hidden px-4 py-3 font-mono text-xs text-slate-500 sm:table-cell">
              - {usageText}
            </td>
            <td className="py-3 pl-4 text-right">
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={adding}
                  className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                >
                  Simpan
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Batal
                </button>
              </div>
            </td>
          </tr>
        );
      }
      return (
        <tr key={item.id} className="hover:bg-slate-50/80">
          <td className="py-3.5 pr-4">
            <Chip name={item.name} color={item.color} />
          </td>
          <td className="px-4 py-3.5">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-500">
              <span
                className="h-3 w-3 rounded-full border border-black/15"
                style={{ backgroundColor: item.color ?? "#cbd5e1" }}
                aria-hidden
              />
              {item.color ?? "-"}
            </span>
          </td>
          <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-500 sm:table-cell">
            - {usageText}
          </td>
          <td className="py-3.5 pl-4 text-right">
            <div className="inline-flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setEditing({ kind, id: item.id, name: item.name, color: item.color ?? "#dcfce7" })
                }
                className="text-xs font-medium text-slate-700 hover:text-slate-950"
              >
                Ubah Nama
              </button>
              <button
                type="button"
                onClick={() => setToDelete({ kind, id: item.id, name: item.name })}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Hapus
              </button>
            </div>
          </td>
        </tr>
      );
    });
  }

  const tableHead = (firstLabel: string) => (
    <thead>
      <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <th className="py-3 pr-4">{firstLabel}</th>
        <th className="px-4 py-3">Kode Warna</th>
        <th className="hidden px-4 py-3 sm:table-cell">Digunakan</th>
        <th className="py-3 pl-4 text-right">Aksi</th>
      </tr>
    </thead>
  );

  return (
    <DashboardShell title="Tag" flush>
      <FlushPage>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Tag &amp; Taksonomi Kontak</h1>
          <p className="mt-1 text-xs text-slate-500">
            Kelola label percakapan dan kategori segmentasi kontak untuk targeting kampanye broadcast dan pelaporan SLA.
          </p>
        </div>

        {!canManage && (
          <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700">
            Hanya owner yang dapat membuat, mengubah, atau menghapus tag dan kategori.
          </p>
        )}

        {error && <p className="mt-4 text-xs text-red-600">{error}</p>}

        {/* Sub-navigation tabs */}
        <div className="mt-5 flex items-center justify-between border-b border-slate-200">
          <div className="flex gap-6">
            <button
              type="button"
              onClick={() => setTab("tags")}
              className={
                tab === "tags"
                  ? "relative py-2.5 text-xs font-semibold text-slate-900 after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-green-600"
                  : "relative py-2.5 text-xs font-medium text-slate-500 hover:text-slate-900"
              }
            >
              Tag Percakapan{" "}
              <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                {tags.data?.total ?? 0}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTab("categories")}
              className={
                tab === "categories"
                  ? "relative py-2.5 text-xs font-semibold text-slate-900 after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-green-600"
                  : "relative py-2.5 text-xs font-medium text-slate-500 hover:text-slate-900"
              }
            >
              Kategori Kontak{" "}
              <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                {categories.data?.length ?? 0}
              </span>
            </button>
          </div>
        </div>

        {/* TAB A: Tag Percakapan */}
        {tab === "tags" && (
          <section>
            <form
              onSubmit={(e) => quickAdd("TAG", e)}
              className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 py-4"
            >
              <input
                type="text"
                required
                maxLength={32}
                placeholder="Nama tag baru (mis. Komplain Prioritas)…"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                disabled={!canManage}
                className="h-8 w-64 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-green-600 focus:outline-none disabled:bg-slate-50"
              />
              <div className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1">
                <input
                  type="color"
                  value={tagColor}
                  onChange={(e) => setTagColor(e.target.value)}
                  className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                />
                <span className="font-mono text-[11px] text-slate-500">Warna</span>
              </div>
              <button
                type="submit"
                disabled={!canManage || adding}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                <Plus size={12} />Tambah Tag
              </button>
            </form>

            {tags.loading && <StateNotice variant="loading" message="Memuat tag…" className="mt-4" />}
            {tags.error && <StateNotice variant="error" message={tags.error} className="mt-4" />}
            {!tags.loading && !tags.error && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    {tableHead("Pratinjau Label")}
                    <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                      {taxonomyRows("TAG").length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-xs text-slate-400">
                            Belum ada tag percakapan.
                          </td>
                        </tr>
                      ) : (
                        taxonomyRows("TAG")
                      )}
                    </tbody>
                  </table>
                </div>
                {tags.data && (
                  <Pagination
                    page={tags.data.page}
                    pageSize={tags.data.pageSize}
                    total={tags.data.total}
                    onPageChange={setPage}
                  />
                )}
              </>
            )}
          </section>
        )}

        {/* TAB B: Kategori Kontak */}
        {tab === "categories" && (
          <section>
            <form
              onSubmit={(e) => quickAdd("CATEGORY", e)}
              className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 py-4"
            >
              <input
                type="text"
                required
                maxLength={32}
                placeholder="Nama kategori baru (mis. Distributor)…"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                disabled={!canManage}
                className="h-8 w-64 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-green-600 focus:outline-none disabled:bg-slate-50"
              />
              <div className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1">
                <input
                  type="color"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                />
                <span className="font-mono text-[11px] text-slate-500">Warna</span>
              </div>
              <button
                type="submit"
                disabled={!canManage || adding}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                <Plus size={12} />Tambah Kategori
              </button>
            </form>

            {categories.loading && (
              <StateNotice variant="loading" message="Memuat kategori…" className="mt-4" />
            )}
            {categories.error && (
              <StateNotice variant="error" message={categories.error} className="mt-4" />
            )}
            {!categories.loading && !categories.error && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  {tableHead("Pratinjau Kategori")}
                  <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                    {taxonomyRows("CATEGORY").length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-xs text-slate-400">
                          Belum ada kategori kontak.
                        </td>
                      </tr>
                    ) : (
                      taxonomyRows("CATEGORY")
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </FlushPage>

      <ConfirmDialog
        open={toDelete !== null}
        title={toDelete?.kind === "TAG" ? "Hapus Tag Percakapan" : "Hapus Kategori Kontak"}
        description={`Apakah Anda yakin ingin menghapus "${toDelete?.name ?? ""}" secara permanen? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus Permanen"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
      <Toast toast={toast} />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(async () => ({ props: {} }));
