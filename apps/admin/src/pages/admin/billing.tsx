import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, X } from "@phosphor-icons/react";
import { cn } from "@csq/ui/lib/utils";
import { AdminShell } from "@/components/admin-shell";
import {
  Btn,
  Empty,
  PageHead,
  Stat,
  Status,
  TableCard,
  btnClass,
} from "@/components/console";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Select } from "@csq/ui/components/ui/select";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";

type Invoice = {
  id: string;
  number: string;
  tenantId: string;
  tenantName: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  amountIdr: number;
  status: "ISSUED" | "PAID" | "VOID";
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
};
type Need = {
  tenantId: string;
  tenantName: string;
  planId: string | null;
  planName: string | null;
  priceIdr: number;
};
type InvoiceList = { items: Invoice[]; needsInvoice: Need[]; monthStart: string };

type Request = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  requestedPlanId: string;
  requestedPlanName: string;
  requestedPlanPrice: number;
  note: string | null;
  status: "NEW" | "CONTACTED" | "DONE" | "REJECTED";
  createdAt: string;
  handledAt: string | null;
};

type Plan = { id: string; name: string; priceIdr: number };
type UsageTenant = { tenantId: string; tenantName: string; planId: string | null; planName: string | null };

type Settings = {
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  dueDays: number;
  graceDays: number;
};

type Tab = "invoices" | "requests" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "invoices", label: "Invoice" },
  { key: "requests", label: "Permintaan paket" },
  { key: "settings", label: "Pengaturan" },
];

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function idr(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Invoice periods are calendar dates stored at UTC boundaries; format in UTC
// so the end date does not shift a day in WIB.
function periodDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function monthValue(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function BillingPage() {
  const { data, loading, error, refresh } = useAdminApi<InvoiceList>("/api/admin/invoices");
  const { data: requestsData, refresh: refreshRequests } =
    useAdminApi<{ items: Request[] }>("/api/admin/plan-requests");
  const { data: plansData } = useAdminApi<{ items: Plan[] }>("/api/admin/plans");
  const { data: usageData } = useAdminApi<{ items: UsageTenant[] }>("/api/admin/usage");
  const { data: settings, refresh: refreshSettings } =
    useAdminApi<Settings>("/api/admin/billing-settings");

  const [tab, setTab] = useState<Tab>("invoices");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    tenantId: "",
    planId: "",
    period: monthValue(),
    amountIdr: "",
    dueAt: "",
  });
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [payForm, setPayForm] = useState({ method: "TRANSFER", reference: "" });
  const [settingsForm, setSettingsForm] = useState({
    bankName: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
    dueDays: "7",
    graceDays: "7",
  });

  useEffect(() => {
    if (!settings) return;
    setSettingsForm({
      bankName: settings.bankName ?? "",
      bankAccountNumber: settings.bankAccountNumber ?? "",
      bankAccountHolder: settings.bankAccountHolder ?? "",
      dueDays: String(settings.dueDays),
      graceDays: String(settings.graceDays),
    });
  }, [settings]);

  const invoices = data?.items ?? [];
  const needs = data?.needsInvoice ?? [];
  const requests = requestsData?.items ?? [];
  const plans = plansData?.items ?? [];
  const tenants = usageData?.items ?? [];

  const outstanding = invoices
    .filter((i) => i.status === "ISSUED")
    .reduce((s, i) => s + i.amountIdr, 0);
  const overdue = invoices.filter(
    (i) => i.status === "ISSUED" && new Date(i.dueAt) < new Date()
  ).length;
  const paidThisMonth = invoices
    .filter(
      (i) =>
        i.status === "PAID" &&
        i.paidAt !== null &&
        new Date(i.paidAt) >= new Date(data?.monthStart ?? new Date())
    )
    .reduce((s, i) => s + i.amountIdr, 0);

  function planPrice(planId: string): number {
    return plans.find((p) => p.id === planId)?.priceIdr ?? 0;
  }

  function openCreate(prefill?: { tenantId: string; planId: string | null; priceIdr: number }) {
    const planId = prefill?.planId ?? "";
    setForm({
      tenantId: prefill?.tenantId ?? "",
      planId,
      period: monthValue(),
      amountIdr: String(prefill?.priceIdr ?? planPrice(planId)),
      dueAt: dateInput(new Date(Date.now() + (settings?.dueDays ?? 7) * 86400000)),
    });
    setActionError(null);
    setShowCreate(true);
  }

  function onTenantChange(tenantId: string) {
    const tenant = tenants.find((t) => t.tenantId === tenantId);
    const planId = tenant?.planId ?? "";
    setForm((f) => ({
      ...f,
      tenantId,
      planId,
      amountIdr: String(planPrice(planId)),
    }));
  }

  function onPlanChange(planId: string) {
    setForm((f) => ({ ...f, planId, amountIdr: String(planPrice(planId)) }));
  }

  async function createInvoice(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setActionError(null);
    try {
      await adminFetch("/api/admin/invoices", "POST", {
        tenantId: form.tenantId,
        planId: form.planId || null,
        period: form.period,
        amountIdr: parseInt(form.amountIdr, 10) || 0,
        dueAt: form.dueAt || undefined,
      });
      setShowCreate(false);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal membuat invoice.");
    } finally {
      setBusy(null);
    }
  }

  async function markPaid() {
    if (!payInvoice) return;
    setBusy(payInvoice.id);
    setActionError(null);
    try {
      await adminFetch("/api/admin/invoices", "PATCH", {
        id: payInvoice.id,
        action: "paid",
        method: payForm.method,
        reference: payForm.reference.trim() || undefined,
      });
      setPayInvoice(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menandai lunas.");
    } finally {
      setBusy(null);
    }
  }

  async function voidInvoice(invoice: Invoice) {
    if (!window.confirm(`Batalkan invoice ${invoice.number}?`)) return;
    setBusy(invoice.id);
    setActionError(null);
    try {
      await adminFetch("/api/admin/invoices", "PATCH", {
        id: invoice.id,
        action: "void",
      });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal membatalkan invoice.");
    } finally {
      setBusy(null);
    }
  }

  async function setRequestStatus(id: string, status: "CONTACTED" | "DONE" | "REJECTED") {
    setBusy(id);
    setActionError(null);
    try {
      await adminFetch("/api/admin/plan-requests", "PATCH", { id, status });
      refreshRequests();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal memperbarui permintaan.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setBusy("settings");
    setActionError(null);
    try {
      await adminFetch("/api/admin/billing-settings", "PUT", {
        bankName: settingsForm.bankName || null,
        bankAccountNumber: settingsForm.bankAccountNumber || null,
        bankAccountHolder: settingsForm.bankAccountHolder || null,
        dueDays: parseInt(settingsForm.dueDays, 10) || 7,
        graceDays: parseInt(settingsForm.graceDays, 10) || 0,
      });
      refreshSettings();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menyimpan pengaturan.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Tagihan">
      <PageHead
        eyebrow="Konfigurasi"
        title="Tagihan"
        sub="Invoice, permintaan paket, dan pengaturan pembayaran"
        action={
          <>
            <Link href="/admin/plans" className={btnClass("line")}>
              Kelola Paket
            </Link>
            <Btn onClick={() => openCreate()}>
              <Plus size={14} weight="bold" />
              Invoice baru
            </Btn>
          </>
        }
      />

      {(actionError || error) && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {actionError ?? error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Belum dibayar"
          value={idr(outstanding)}
          note={`${invoices.filter((i) => i.status === "ISSUED").length} invoice`}
        />
        <Stat label="Jatuh tempo" value={overdue} note="Perlu ditindaklanjuti" />
        <Stat label="Dibayar bulan ini" value={idr(paidThisMonth)} note="Total invoice lunas" />
      </div>

      <div className="mb-5 flex gap-5 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 pb-2 text-[13px] transition-colors",
              tab === t.key
                ? "border-green-700 font-medium text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "invoices" && (
        <div className="space-y-5">
          {needs.length > 0 && (
            <div className="panel overflow-hidden">
              <div className="panel-h">
                <h2 className="panel-t">Perlu ditagih</h2>
                <span className="text-[11px] text-slate-400">Belum ada invoice bulan ini</span>
              </div>
              <div className="divide-y divide-slate-100">
                {needs.map((n) => (
                  <div key={n.tenantId} className="flex items-center gap-4 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-900">{n.tenantName}</p>
                      <p className="text-[11.5px] text-slate-400">
                        {n.planName ?? "Tanpa paket"}, {idr(n.priceIdr)}
                      </p>
                    </div>
                    <Btn
                      variant="line"
                      onClick={() =>
                        openCreate({ tenantId: n.tenantId, planId: n.planId, priceIdr: n.priceIdr })
                      }
                    >
                      Buat
                    </Btn>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && invoices.length === 0 ? (
            <Empty
              title="Belum ada invoice"
              hint="Buat invoice pertama dari daftar perlu ditagih atau tombol di atas."
            />
          ) : (
            <TableCard>
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Nomor</th>
                    <th>Tenant</th>
                    <th>Periode</th>
                    <th className="text-right">Jumlah</th>
                    <th>Status</th>
                    <th>Jatuh tempo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => {
                    const isOverdue = i.status === "ISSUED" && new Date(i.dueAt) < new Date();
                    return (
                      <tr key={i.id}>
                        <td className="font-mono text-[12px]">{i.number}</td>
                        <td>
                          <div className="font-medium">{i.tenantName}</div>
                          <div className="text-[12px] text-muted-foreground">{i.planName}</div>
                        </td>
                        <td className="whitespace-nowrap text-[12.5px] text-muted-foreground">
                          {periodDate(i.periodStart)} - {periodDate(i.periodEnd)}
                        </td>
                        <td className="text-right font-mono tabular-nums">{idr(i.amountIdr)}</td>
                        <td>
                          <Status
                            tone={
                              i.status === "PAID"
                                ? "ok"
                                : i.status === "VOID"
                                  ? "off"
                                  : isOverdue
                                    ? "bad"
                                    : "warn"
                            }
                          >
                            {i.status === "PAID"
                              ? "Lunas"
                              : i.status === "VOID"
                                ? "Dibatalkan"
                                : isOverdue
                                  ? "Jatuh tempo"
                                  : "Belum dibayar"}
                          </Status>
                        </td>
                        <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                          {i.status === "PAID" && i.paidAt ? date(i.paidAt) : date(i.dueAt)}
                        </td>
                        <td className="text-right">
                          {i.status === "ISSUED" && (
                            <>
                              <Btn
                                variant="ghost"
                                disabled={busy === i.id}
                                onClick={() => {
                                  setActionError(null);
                                  setPayForm({ method: "TRANSFER", reference: "" });
                                  setPayInvoice(i);
                                }}
                                className="hover:text-primary"
                              >
                                Lunas
                              </Btn>
                              <Btn
                                variant="ghost"
                                disabled={busy === i.id}
                                onClick={() => void voidInvoice(i)}
                                className="hover:text-bad"
                              >
                                Batalkan
                              </Btn>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {loading && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-[13px] text-muted-foreground">
                        Memuat...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableCard>
          )}
        </div>
      )}

      {tab === "requests" && (
        <div>
          {requests.length === 0 ? (
            <Empty
              title="Belum ada permintaan paket"
              hint="Permintaan dari halaman Paket & Kuota tenant muncul di sini."
            />
          ) : (
            <TableCard>
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Paket diminta</th>
                    <th>Catatan</th>
                    <th>Status</th>
                    <th>Dibuat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="font-medium">{r.tenantName}</div>
                        <div className="text-[12px] text-muted-foreground">{r.tenantSlug}</div>
                      </td>
                      <td>
                        <div>{r.requestedPlanName}</div>
                        <div className="font-mono text-[12px] text-muted-foreground">
                          {idr(r.requestedPlanPrice)}
                        </div>
                      </td>
                      <td className="max-w-xs truncate text-[12.5px] text-muted-foreground">
                        {r.note ?? "-"}
                      </td>
                      <td>
                        <Status
                          tone={
                            r.status === "DONE"
                              ? "ok"
                              : r.status === "REJECTED"
                                ? "off"
                                : "warn"
                          }
                        >
                          {r.status === "NEW"
                            ? "Baru"
                            : r.status === "CONTACTED"
                              ? "Dihubungi"
                              : r.status === "DONE"
                                ? "Selesai"
                                : "Ditolak"}
                        </Status>
                      </td>
                      <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                        {date(r.createdAt)}
                      </td>
                      <td className="text-right">
                        {r.status === "NEW" && (
                          <Btn
                            variant="ghost"
                            disabled={busy === r.id}
                            onClick={() => void setRequestStatus(r.id, "CONTACTED")}
                          >
                            Hubungi
                          </Btn>
                        )}
                        {(r.status === "NEW" || r.status === "CONTACTED") && (
                          <>
                            <Btn
                              variant="ghost"
                              disabled={busy === r.id}
                              onClick={() => void setRequestStatus(r.id, "DONE")}
                              className="hover:text-primary"
                            >
                              Selesai
                            </Btn>
                            <Btn
                              variant="ghost"
                              disabled={busy === r.id}
                              onClick={() => void setRequestStatus(r.id, "REJECTED")}
                              className="hover:text-bad"
                            >
                              Tolak
                            </Btn>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
        </div>
      )}

      {tab === "settings" && (
        <form onSubmit={saveSettings} className="panel p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bank-name">Bank</Label>
              <Input
                id="bank-name"
                value={settingsForm.bankName}
                onChange={(e) => setSettingsForm({ ...settingsForm, bankName: e.target.value })}
                placeholder="BCA"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-number">Nomor rekening</Label>
              <Input
                id="bank-number"
                value={settingsForm.bankAccountNumber}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, bankAccountNumber: e.target.value })
                }
                placeholder="1234567890"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bank-holder">Atas nama</Label>
              <Input
                id="bank-holder"
                value={settingsForm.bankAccountHolder}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, bankAccountHolder: e.target.value })
                }
                placeholder="PT CSQ Indonesia"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due-days">Jatuh tempo (hari)</Label>
              <Input
                id="due-days"
                type="number"
                min={1}
                max={90}
                value={settingsForm.dueDays}
                onChange={(e) => setSettingsForm({ ...settingsForm, dueDays: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grace-days">Tenggang (hari)</Label>
              <Input
                id="grace-days"
                type="number"
                min={0}
                max={90}
                value={settingsForm.graceDays}
                onChange={(e) => setSettingsForm({ ...settingsForm, graceDays: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-[11.5px] text-muted-foreground">
              Kosongkan bank untuk menampilkan "Hubungi admin" di tenant.
            </p>
            <Btn type="submit" disabled={busy === "settings"}>
              {busy === "settings" ? "Menyimpan..." : "Simpan"}
            </Btn>
          </div>
        </form>
      )}

      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        ariaLabel="Invoice baru"
        className="max-w-lg rounded-2xl border-border bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
      >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <div className="eyebrow mb-1">Tagihan</div>
                <h2 className="text-[18px] font-semibold tracking-tight">Invoice baru</h2>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={createInvoice} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="inv-tenant">Tenant</Label>
                <Select
                  id="inv-tenant"
                  required
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                  value={form.tenantId}
                  onChange={(e) => onTenantChange(e.target.value)}
                >
                  <option value="">- pilih tenant -</option>
                  {tenants.map((t) => (
                    <option key={t.tenantId} value={t.tenantId}>
                      {t.tenantName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-plan">Paket</Label>
                  <Select
                    id="inv-plan"
                    className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                    value={form.planId}
                    onChange={(e) => onPlanChange(e.target.value)}
                  >
                    <option value="">Manual</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-period">Periode</Label>
                  <Input
                    id="inv-period"
                    type="month"
                    required
                    value={form.period}
                    onChange={(e) => setForm({ ...form, period: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-amount">Jumlah (IDR)</Label>
                  <Input
                    id="inv-amount"
                    type="number"
                    required
                    value={form.amountIdr}
                    onChange={(e) => setForm({ ...form, amountIdr: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-due">Jatuh tempo</Label>
                  <Input
                    id="inv-due"
                    type="date"
                    value={form.dueAt}
                    onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                  />
                </div>
              </div>
              {actionError && <p className="text-[13px] text-bad">{actionError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Btn type="button" variant="line" onClick={() => setShowCreate(false)}>
                  Batal
                </Btn>
                <Btn type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Membuat..." : "Buat invoice"}
                </Btn>
              </div>
            </form>
      </Dialog>

      {payInvoice && (
        <Dialog
          open
          onClose={() => setPayInvoice(null)}
          ariaLabel="Tandai lunas"
          className="max-w-sm rounded-2xl border-border bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
        >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <div className="eyebrow mb-1">{payInvoice.number}</div>
                <h2 className="text-[18px] font-semibold tracking-tight">Tandai lunas</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {payInvoice.tenantName}, {idr(payInvoice.amountIdr)}
                </p>
              </div>
              <button
                onClick={() => setPayInvoice(null)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="pay-method">Metode</Label>
                <Select
                  id="pay-method"
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                  value={payForm.method}
                  onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
                >
                  <option value="TRANSFER">Transfer</option>
                  <option value="CASH">Tunai</option>
                  <option value="OTHER">Lainnya</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Referensi (opsional)</Label>
                <Input
                  id="pay-ref"
                  value={payForm.reference}
                  onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                  placeholder="Nomor transaksi"
                />
              </div>
              {actionError && <p className="text-[13px] text-bad">{actionError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Btn type="button" variant="line" onClick={() => setPayInvoice(null)}>
                  Batal
                </Btn>
                <Btn onClick={() => void markPaid()} disabled={busy === payInvoice.id}>
                  {busy === payInvoice.id ? "Menyimpan..." : "Tandai lunas"}
                </Btn>
              </div>
            </div>
        </Dialog>
      )}
    </AdminShell>
  );
}
