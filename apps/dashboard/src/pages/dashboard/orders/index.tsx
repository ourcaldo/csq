// /dashboard/orders - enterprise order ledger revamp (template 2026-11-22):
// telemetry strip, underlined status tab filter, ALWAYS-VISIBLE line items
// (no expand), and a FULL-PAGE order composer with pill product selectors
// (zero dropdowns) + live grand total.
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { ArrowLeft, Plus, PlusCircle, Trash } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult, Order, OrderStatus, Product } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { TelemetryStrip } from "@/components/dashboard/telemetry-strip";
import { FlushPage } from "@/components/dashboard/flush-page";
import { Toast } from "@/components/dashboard/channels/toast";
import type { ToastState } from "@/components/dashboard/channels/types";

const PAGE_SIZE = 10;

function formatIDR(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return String(value);
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function orderNumber(id: string): string {
  return "#" + id.slice(0, 8).toUpperCase();
}

function StatusDot({ status }: { status: OrderStatus }) {
  const dot =
    status === "CONFIRMED"
      ? "bg-green-500"
      : status === "CANCELLED"
        ? "bg-slate-300"
        : "bg-amber-400";
  return <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />;
}

type DraftLine = { productId: string; qty: number };

export default function OrdersPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"" | OrderStatus>("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  function showToast(msg: string) {
    setToast({ tone: "success", msg });
    setTimeout(() => setToast(null), 2600);
  }

  const ordersUrl = `/api/dashboard/orders?page=${page}&pageSize=${PAGE_SIZE}${
    statusFilter ? `&status=${statusFilter}` : ""
  }`;
  const { data, loading, error, refresh } = useApi<ListResult<Order>>(ordersUrl);
  // KPI strip always shows the OVERALL ledger (template semantics), so it
  // reads the unfiltered set, not the tab-filtered one.
  const all = useApi<ListResult<Order>>("/api/dashboard/orders?page=1&pageSize=1");
  const { data: productsData } = useApi<ListResult<Product>>(
    "/api/dashboard/products?page=1&pageSize=100"
  );
  const productMap = useMemo(
    () => new Map<string, Product>((productsData?.items ?? []).map((p) => [p.id, p])),
    [productsData]
  );

  // Composer state (null = list view).
  const [composerOpen, setComposerOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function changeStatus(order: Order, status: OrderStatus) {
    setUpdatingId(order.id);
    try {
      await apiSend<Order>(`/api/dashboard/orders/${order.id}`, "PUT", { status });
      showToast(
        `Pesanan ${orderNumber(order.id)} ditandai ${status === "CONFIRMED" ? "Dikonfirmasi" : "Dibatalkan"}`
      );
      refresh();
      all.refresh();
    } catch (err) {
      setToast({ tone: "error", msg: err instanceof Error ? err.message : "Gagal memperbarui status." });
      setTimeout(() => setToast(null), 2600);
    } finally {
      setUpdatingId(null);
    }
  }

  function openComposer() {
    const first = productsData?.items[0];
    setCustomerName("");
    setCustomerPhone("");
    setDraftLines(first ? [{ productId: first.id, qty: 1 }] : []);
    setFormError(null);
    setComposerOpen(true);
  }

  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setDraftLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const grandTotal = draftLines.reduce((sum, l) => {
    const p = productMap.get(l.productId);
    return sum + (p ? Number(p.price) * l.qty : 0);
  }, 0);

  async function submitOrder(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const created = await apiSend<Order>("/api/dashboard/orders/create", "POST", {
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        items: draftLines.map((l) => ({ productId: l.productId, quantity: l.qty })),
      });
      setComposerOpen(false);
      showToast(`Pesanan baru ${orderNumber(created.id)} berhasil dibuat`);
      refresh();
      all.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat pesanan.");
    } finally {
      setSaving(false);
    }
  }

  const kpi = useMemo(() => {
    const total = all.data?.total ?? 0;
    const pendingCount = (data?.items ?? []).filter((o) => o.status === "PENDING").length;
    const confirmed = (data?.items ?? []).filter((o) => o.status === "CONFIRMED");
    const rev = confirmed.reduce((s, o) => s + Number(o.totalAmount), 0);
    return { total, pending: pendingCount, confirmed: confirmed.length, rev };
  }, [all.data, data]);

  const statusTabs: { key: "" | OrderStatus; label: string }[] = [
    { key: "", label: "Semua" },
    { key: "PENDING", label: "Menunggu" },
    { key: "CONFIRMED", label: "Dikonfirmasi" },
    { key: "CANCELLED", label: "Dibatalkan" },
  ];

  // ─── Full-page composer view ───
  if (composerOpen) {
    return (
      <DashboardShell title="Buat Pesanan Baru">
        <div className="w-full px-4 py-7 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setComposerOpen(false)}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <ArrowLeft size={12} />Pesanan
                </button>
                <span className="text-slate-300">/</span>
                <span className="font-medium text-slate-700">Buat Pesanan Baru</span>
              </div>
              <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
                Buat Pesanan Baru
              </h1>
              <p className="mt-1 text-xs text-slate-500">
                Catat pesanan pelanggan secara manual dan hubungkan ke nomor WhatsApp kontak.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
          </div>

          <form onSubmit={submitOrder} className="divide-y divide-slate-200">
            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Informasi Pelanggan</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Identitas pemesan dan nomor WhatsApp aktif untuk pengiriman notifikasi konfirmasi.
                </p>
              </div>
              <div className="grid max-w-xl grid-cols-1 gap-3.5 sm:grid-cols-2 md:col-span-8">
                <div>
                  <label htmlFor="of-customer" className="block text-xs font-medium text-slate-700">
                    Nama Pelanggan <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="of-customer"
                    type="text"
                    required
                    placeholder="mis. Siti Rahmawati"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  />
                </div>
                <div>
                  <label htmlFor="of-phone" className="block text-xs font-medium text-slate-700">
                    Nomor WhatsApp <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="of-phone"
                    type="text"
                    required
                    placeholder="628123456789"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-xs text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Daftar Item Pesanan</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Pilih produk dari katalog dan tentukan kuantitas masing-masing item.
                </p>
              </div>
              <div className="max-w-3xl space-y-3 md:col-span-8">
                {draftLines.map((line, idx) => {
                  const prod = productMap.get(line.productId);
                  const subtotal = prod ? Number(prod.price) * line.qty : 0;
                  return (
                    <div key={idx} className="border-b border-slate-200 pb-3 last:border-b-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Item #{idx + 1}
                        </span>
                        {draftLines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setDraftLines((prev) => prev.filter((_, i) => i !== idx))}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                          >
                            <Trash size={12} />Hapus Baris
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(productsData?.items ?? []).map((p) => {
                          const selected = p.id === line.productId;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => updateLine(idx, { productId: p.id })}
                              className={
                                selected
                                  ? "rounded-md border border-green-600 bg-green-50 px-2.5 py-1.5 text-left text-xs font-semibold text-green-900 transition"
                                  : "rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-50"
                              }
                            >
                              <span>{p.name}</span>
                              <span
                                className={`ml-1.5 font-mono text-[11px] ${selected ? "text-green-700" : "text-slate-400"}`}
                              >
                                {formatIDR(p.price)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-slate-600">Kuantitas:</label>
                          <input
                            type="number"
                            min="1"
                            value={line.qty}
                            onChange={(e) => updateLine(idx, { qty: Number(e.target.value) || 1 })}
                            className="h-8 w-20 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 focus:border-green-600 focus:outline-none"
                          />
                        </div>
                        <span className="font-mono text-xs font-semibold tabular-nums text-slate-800">
                          Subtotal: {formatIDR(subtotal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const first = productsData?.items[0];
                      if (first) setDraftLines((prev) => [...prev, { productId: first.id, qty: 1 }]);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700 hover:underline"
                  >
                    <PlusCircle size={14} />Tambah Baris Produk
                  </button>
                  <div className="text-xs text-slate-600">
                    Estimasi Total:{" "}
                    <strong className="ml-1 font-mono text-sm font-semibold text-slate-900">
                      {formatIDR(grandTotal)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {formError && <p className="pb-2 text-xs text-red-600">{formError}</p>}

            <div className="flex items-center justify-end gap-2.5 pt-5">
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || draftLines.length === 0}
                className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {saving ? "Membuat…" : "Buat Pesanan"}
              </button>
            </div>
          </form>
        </div>
      </DashboardShell>
    );
  }

  // ─── List view ───
  return (
    <DashboardShell title="Pesanan" flush>
      <FlushPage>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Pesanan</h1>
            <p className="mt-1 text-xs text-slate-500">
              Pantau transaksi masuk dari percakapan WhatsApp maupun entri manual dan kelola status pemenuhannya.
            </p>
          </div>
          <button
            type="button"
            onClick={openComposer}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
          >
            <Plus size={14} />Buat Pesanan Baru
          </button>
        </div>

        <TelemetryStrip
          cells={[
            { label: "Total Pesanan", value: String(kpi.total) },
            { label: "Menunggu Konfirmasi", value: String(kpi.pending), valueClass: "text-amber-600" },
            { label: "Dikonfirmasi", value: String(kpi.confirmed), valueClass: "text-green-700" },
            { label: "Nilai Terkonfirmasi", value: formatIDR(kpi.rev) },
          ]}
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200">
          <div className="flex gap-6">
            {statusTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.key);
                  setPage(1);
                }}
                className={
                  statusFilter === tab.key
                    ? "relative py-2.5 text-xs font-semibold text-slate-900 after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-green-600"
                    : "relative py-2.5 text-xs font-medium text-slate-500 hover:text-slate-900"
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading && <StateNotice variant="loading" message="Memuat pesanan…" className="mt-4" />}
        {error && <StateNotice variant="error" message={error} className="mt-4" />}
        {!loading && !error && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 pr-4">No. Pesanan</th>
                    <th className="px-4 py-3">Pelanggan</th>
                    <th className="px-4 py-3">Rincian Item</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="hidden px-4 py-3 md:table-cell">Tanggal</th>
                    <th className="py-3 pl-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                  {(data?.items ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                        Tidak ada pesanan yang sesuai dengan filter.
                      </td>
                    </tr>
                  )}
                  {(data?.items ?? []).map((o) => (
                    <tr key={o.id} className="align-top hover:bg-slate-50/80">
                      <td className="py-3.5 pr-4 font-mono text-xs font-medium text-slate-600">
                        {orderNumber(o.id)}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs font-semibold text-slate-900">
                          {o.customerName ?? o.customerPhone ?? "-"}
                        </p>
                        {o.customerPhone && (
                          <p className="mt-0.5 font-mono text-[11px] text-slate-400">{o.customerPhone}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="min-w-48 space-y-1">
                          {o.items.map((it) => {
                            const p = productMap.get(it.productId);
                            return (
                              <div key={it.id} className="flex items-center justify-between gap-3 text-xs">
                                <span className="text-slate-800">
                                  {p?.name ?? it.productId.slice(0, 8)}{" "}
                                  <span className="font-mono text-slate-400">x{it.quantity}</span>
                                </span>
                                <span className="font-mono text-[11px] tabular-nums text-slate-500">
                                  {formatIDR(it.subtotal)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-900">
                        {formatIDR(o.totalAmount)}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={
                            o.status === "CONFIRMED"
                              ? "inline-flex items-center gap-1.5 text-xs font-medium text-green-700"
                              : o.status === "CANCELLED"
                                ? "inline-flex items-center gap-1.5 text-xs text-slate-400"
                                : "inline-flex items-center gap-1.5 text-xs font-medium text-amber-700"
                          }
                        >
                          <StatusDot status={o.status} />
                          {o.status === "CONFIRMED" ? "Dikonfirmasi" : o.status === "CANCELLED" ? "Dibatalkan" : "Menunggu"}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-500 md:table-cell">
                        {formatDate(o.createdAt)}
                      </td>
                      <td className="py-3.5 pl-4 text-right">
                        <div className="inline-flex items-center gap-3">
                          {o.status !== "CONFIRMED" && (
                            <button
                              type="button"
                              disabled={updatingId === o.id}
                              onClick={() => changeStatus(o, "CONFIRMED")}
                              className="text-xs font-semibold text-green-700 hover:underline disabled:opacity-50"
                            >
                              Konfirmasi
                            </button>
                          )}
                          {o.status !== "CANCELLED" && (
                            <button
                              type="button"
                              disabled={updatingId === o.id}
                              onClick={() => changeStatus(o, "CANCELLED")}
                              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                            >
                              Batalkan
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      </FlushPage>
      <Toast toast={toast} />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(async () => ({ props: {} }));
