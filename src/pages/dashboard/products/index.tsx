import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult, Product } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PAGE_SIZE = 10;

type FormState = {
  name: string;
  sku: string;
  price: string;
  description: string;
};

const EMPTY_FORM: FormState = { name: "", sku: "", price: "", description: "" };

function formatRupiah(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return "Rp " + n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function ProductsPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const url = `/api/dashboard/products?page=${page}&pageSize=${PAGE_SIZE}${
    search ? `&search=${encodeURIComponent(search)}` : ""
  }`;
  const { data, loading, error, refresh } = useApi<ListResult<Product>>(url);

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
      if (editing) {
        await apiSend<Product>(`/api/dashboard/products/${editing.id}`, "PUT", payload);
      } else {
        await apiSend<Product>("/api/dashboard/products", "POST", payload);
      }
      setFormOpen(false);
      refresh();
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
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus produk.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DashboardShell
      title="Produk"
      description="Kelola katalog produk dan harga."
      actions={<Button onClick={openCreate}>Tambah Produk</Button>}
    >
      <form onSubmit={applySearch} className="mb-4 flex gap-2">
        <Input
          placeholder="Cari nama produk…"
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <Button type="submit" variant="secondary">
          Cari
        </Button>
      </form>

      {loading && <StateNotice variant="loading" message="Memuat produk…" />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Harga</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <StateNotice variant="empty" message="Belum ada produk." />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.sku ?? "—"}</TableCell>
                    <TableCell>{formatRupiah(p.price)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setToDelete(p)}
                        >
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
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit Produk" : "Tambah Produk"}
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-name">Nama</Label>
            <Input
              id="product-name"
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-sku">SKU</Label>
            <Input
              id="product-sku"
              value={form.sku}
              onChange={(e) => update("sku", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-price">Harga (Rp)</Label>
            <Input
              id="product-price"
              type="number"
              step="0.01"
              min="0"
              required
              value={form.price}
              onChange={(e) => update("price", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-desc">Deskripsi</Label>
            <Textarea
              id="product-desc"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
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
        title="Hapus Produk"
        description={`Yakin ingin menghapus "${toDelete?.name}"? Tindakan ini tidak dapat dibatalkan.`}
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
