import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { InventorySource, InventoryWithProduct, ListResult } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PAGE_SIZE = 10;

const SOURCE_LABEL: Record<InventorySource, string> = {
  MANUAL: "Manual",
  EXCEL: "Excel",
  GOOGLE_SHEETS: "Google Sheets",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function InventoryPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<InventoryWithProduct | null>(null);
  const [quantity, setQuantity] = useState("0");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const url = `/api/dashboard/inventory?page=${page}&pageSize=${PAGE_SIZE}${
    search ? `&search=${encodeURIComponent(search)}` : ""
  }`;
  const { data, loading, error, refresh } = useApi<ListResult<InventoryWithProduct>>(url);

  function applySearch(e: FormEvent) {
    e.preventDefault();
    setSearch(query);
    setPage(1);
  }

  function openEdit(inv: InventoryWithProduct) {
    setEditing(inv);
    setQuantity(String(inv.quantity));
    setFormError(null);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiSend(`/api/dashboard/inventory/${editing.productId}`, "PUT", {
        quantity: Number(quantity),
        source: "MANUAL",
      });
      setEditing(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan stok.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell title="Inventaris" description="Pantau dan sesuaikan stok produk.">
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

      {loading && <StateNotice variant="loading" message="Memuat inventaris…" />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Jumlah</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead>Diperbarui</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <StateNotice variant="empty" message="Belum ada inventaris." />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.product.name}</TableCell>
                    <TableCell>
                      <span
                        className={
                          inv.quantity <= 0
                            ? "font-semibold text-destructive"
                            : "font-medium"
                        }
                      >
                        {inv.quantity}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{SOURCE_LABEL[inv.source]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(inv)}>
                        Ubah Stok
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
        title={`Ubah Stok — ${editing?.product.name ?? ""}`}
      >
        <form onSubmit={onSave} className="flex flex-col gap-4">
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inventory-quantity">Jumlah</Label>
            <Input
              id="inventory-quantity"
              type="number"
              min="0"
              step="1"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
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
