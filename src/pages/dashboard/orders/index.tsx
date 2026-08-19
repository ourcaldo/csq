import { Fragment, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult, Order, OrderStatus, Product } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PAGE_SIZE = 10;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Semua status" },
  { value: "PENDING", label: "Menunggu" },
  { value: "CONFIRMED", label: "Dikonfirmasi" },
  { value: "CANCELLED", label: "Dibatalkan" },
];

function statusBadge(status: OrderStatus) {
  if (status === "CONFIRMED") return <Badge variant="success">Dikonfirmasi</Badge>;
  if (status === "CANCELLED") return <Badge variant="destructive">Dibatalkan</Badge>;
  return <Badge variant="warning">Menunggu</Badge>;
}

// Short, unique, human-friendly order number derived from the uuid id.
function orderNumber(id: string): string {
  return "#" + id.slice(0, 8).toUpperCase();
}

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

type LineItem = { productId: string; quantity: string };

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ productId: "", quantity: "1" }]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const ordersUrl = `/api/dashboard/orders?page=${page}&pageSize=${PAGE_SIZE}${
    statusFilter ? `&status=${statusFilter}` : ""
  }`;
  const { data, loading, error, refresh } = useApi<ListResult<Order>>(ordersUrl);
  const { data: productsData } = useApi<ListResult<Product>>(
    "/api/dashboard/products?page=1&pageSize=100"
  );

  const productMap = new Map<string, Product>(
    (productsData?.items ?? []).map((p) => [p.id, p])
  );

  async function changeStatus(order: Order, status: OrderStatus) {
    setUpdatingId(order.id);
    try {
      await apiSend<Order>(`/api/dashboard/orders/${order.id}`, "PUT", { status });
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setUpdatingId(null);
    }
  }

  function setItem(index: number, field: keyof LineItem, value: string) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, [field]: value } : it))
    );
  }

  function addItem() {
    setItems((prev) => [...prev, { productId: "", quantity: "1" }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        items: items
          .filter((it) => it.productId && Number(it.quantity) > 0)
          .map((it) => ({ productId: it.productId, quantity: Number(it.quantity) })),
      };
      if (payload.items.length === 0) {
        setFormError("Tambahkan minimal satu item produk.");
        setSaving(false);
        return;
      }
      await apiSend<Order>("/api/dashboard/orders/create", "POST", payload);
      setCreateOpen(false);
      setCustomerName("");
      setCustomerPhone("");
      setItems([{ productId: "", quantity: "1" }]);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat pesanan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell
      title="Pesanan"
      description="Lihat pesanan dan ubah statusnya."
      actions={<Button onClick={() => setCreateOpen(true)}>Tambah Pesanan</Button>}
    >
      <div className="mb-4 flex items-center gap-2">
        <Label htmlFor="order-status-filter" className="sr-only">
          Filter status
        </Label>
        <Select
          id="order-status-filter"
          value={statusFilter}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {formError && <p className="mb-4 text-sm text-destructive">{formError}</p>}
      {loading && <StateNotice variant="loading" message="Memuat pesanan…" />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Pesanan</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <StateNotice variant="empty" message="Belum ada pesanan." />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((o) => (
                  <Fragment key={o.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {orderNumber(o.id)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {o.customerName ?? o.customerPhone ?? "—"}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-sm text-primary underline"
                          onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                        >
                          {o.items.length} item
                        </button>
                      </TableCell>
                      <TableCell>{formatRupiah(o.totalAmount)}</TableCell>
                      <TableCell>{statusBadge(o.status)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {o.status !== "CONFIRMED" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={updatingId === o.id}
                              onClick={() => changeStatus(o, "CONFIRMED")}
                            >
                              Konfirmasi
                            </Button>
                          )}
                          {o.status !== "CANCELLED" && (
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={updatingId === o.id}
                              onClick={() => changeStatus(o, "CANCELLED")}
                            >
                              Batalkan
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded === o.id && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30">
                          <ul className="flex flex-col gap-1 py-1 text-sm">
                            {o.items.map((it) => (
                              <li key={it.id} className="flex justify-between">
                                <span>
                                  {productMap.get(it.productId)?.name ?? "Produk dihapus"}{" "}
                                  <span className="text-muted-foreground">
                                    × {it.quantity}
                                  </span>
                                </span>
                                <span className="text-muted-foreground">
                                  {formatRupiah(it.subtotal)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
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
        title="Tambah Pesanan"
      >
        <form onSubmit={onCreate} className="flex flex-col gap-4">
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-customer-name">Nama Pelanggan</Label>
            <Input
              id="order-customer-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-customer-phone">No. Telepon</Label>
            <Input
              id="order-customer-phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Item</Label>
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={it.productId}
                  onChange={(e) => setItem(i, "productId", e.target.value)}
                  required
                >
                  <option value="">Pilih produk…</option>
                  {productsData?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatRupiah(p.price)}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={it.quantity}
                  onChange={(e) => setItem(i, "quantity", e.target.value)}
                  className="w-24"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeItem(i)}
                  disabled={items.length <= 1}
                >
                  Hapus
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addItem} className="w-fit">
              Tambah Item
            </Button>
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
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
