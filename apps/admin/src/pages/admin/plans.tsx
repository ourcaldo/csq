import { type FormEvent, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, Section, TableCard } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";

type Plan = {
  id: string;
  name: string;
  priceIdr: number;
  limits: Record<string, number | null>;
  tenantCount: number;
};
type PlanList = { items: Plan[] };
type UsageItem = {
  tenantId: string;
  tenantName: string;
  planName: string | null;
  planId: string | null;
  agentReplies: number;
  agentRepliesLimit: number | null;
  agentRepliesOver: boolean;
  outbound: number;
  outboundLimit: number | null;
  outboundOver: boolean;
  inbound: number;
  channelCount: number;
  mediaBytes: number;
};
type UsageData = { items: UsageItem[]; monthStart: string };

const EMPTY_FORM = { name: "", priceIdr: "0", agentReplies: "", messagesOut: "", channels: "" };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function idr(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function limit(v: number | null | undefined): string {
  return v === null || v === undefined ? "Tanpa batas" : v.toLocaleString("id-ID");
}

export default function PlansPage() {
  const { data: plansData, loading: pLoading, refresh: refreshPlans } =
    useAdminApi<PlanList>("/api/admin/plans");
  const { data: usageData, loading: uLoading } = useAdminApi<UsageData>("/api/admin/usage");
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  async function createPlan(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setFormError(null);
    try {
      await adminFetch("/api/admin/plans", "POST", {
        name: form.name,
        priceIdr: parseInt(form.priceIdr, 10) || 0,
        limits: {
          agentRepliesPerMonth: form.agentReplies ? parseInt(form.agentReplies, 10) : null,
          messagesOutPerMonth: form.messagesOut ? parseInt(form.messagesOut, 10) : null,
          channels: form.channels ? parseInt(form.channels, 10) : null,
        },
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      refreshPlans();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat paket.");
    } finally {
      setBusy(null);
    }
  }

  async function assignPlan(tenantId: string, planId: string | null) {
    setBusy(tenantId);
    try {
      await adminFetch("/api/admin/plans", "PATCH", { tenantId, planId });
      refreshPlans();
    } finally {
      setBusy(null);
    }
  }

  const plans = plansData?.items ?? [];
  const usage = usageData?.items ?? [];

  return (
    <AdminShell title="Paket & Penggunaan">
      <PageHead
        eyebrow="Konfigurasi"
        title="Paket & Penggunaan"
        sub="Plan & metering per tenant"
        action={
          <Btn onClick={() => setShowCreate(true)}>
            <Plus size={14} weight="bold" />
            Paket baru
          </Btn>
        }
      />

      <Section title="Paket tersedia" meta={`${plans.length} paket`}>
        {!pLoading && plans.length === 0 ? (
          <Empty
            title="Belum ada paket"
            hint="Buat paket pertama untuk mulai menagih tenant."
          />
        ) : (
          <TableCard>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th className="text-right">Harga / bulan</th>
                  <th className="text-right">Balasan AI</th>
                  <th className="text-right">Pesan keluar</th>
                  <th className="text-right">Saluran</th>
                  <th className="text-right">Tenant</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.name}</td>
                    <td className="text-right font-mono tabular-nums">{idr(p.priceIdr)}</td>
                    <td className="text-right font-mono tabular-nums">
                      {limit(p.limits?.agentRepliesPerMonth)}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {limit(p.limits?.messagesOutPerMonth)}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {limit(p.limits?.channels)}
                    </td>
                    <td className="text-right font-mono tabular-nums">{p.tenantCount}</td>
                  </tr>
                ))}
                {pLoading && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[13px] text-muted-foreground">
                      Memuat...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <Section
        title="Penggunaan bulan ini"
        meta={
          usageData
            ? `sejak ${new Date(usageData.monthStart).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "short",
              })}`
            : undefined
        }
      >
        {!uLoading && usage.length === 0 ? (
          <Empty title="Belum ada tenant" hint="Penggunaan muncul setelah tenant aktif." />
        ) : (
          <TableCard>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Paket</th>
                  <th className="text-right">Balasan AI</th>
                  <th className="text-right">Keluar</th>
                  <th className="text-right">Masuk</th>
                  <th className="text-right">Media</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.tenantId}>
                    <td>
                      <div className="font-medium">{u.tenantName}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {u.channelCount} saluran
                      </div>
                    </td>
                    <td>
                      <select
                        className="h-7 rounded-sm border border-input bg-card px-2 text-[12.5px] text-muted-foreground"
                        value={u.planId ?? ""}
                        disabled={busy === u.tenantId}
                        onChange={(e) => void assignPlan(u.tenantId, e.target.value || null)}
                        aria-label={`Paket untuk ${u.tenantName}`}
                      >
                        <option value="">- tanpa paket -</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td
                      className={`text-right font-mono tabular-nums ${
                        u.agentRepliesOver ? "font-medium text-bad" : ""
                      }`}
                    >
                      {u.agentReplies}
                      {u.agentRepliesLimit ? ` / ${u.agentRepliesLimit}` : ""}
                    </td>
                    <td
                      className={`text-right font-mono tabular-nums ${
                        u.outboundOver ? "font-medium text-bad" : ""
                      }`}
                    >
                      {u.outbound}
                      {u.outboundLimit ? ` / ${u.outboundLimit}` : ""}
                    </td>
                    <td className="text-right font-mono tabular-nums">{u.inbound}</td>
                    <td className="text-right font-mono tabular-nums">{bytes(u.mediaBytes)}</td>
                  </tr>
                ))}
                {uLoading && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[13px] text-muted-foreground">
                      Memuat...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-16"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <div className="eyebrow mb-1">Konfigurasi</div>
                <h2 className="text-[18px] font-semibold tracking-tight">Paket baru</h2>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={createPlan} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">Nama paket</Label>
                <Input
                  id="p-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Starter"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-price">Harga per bulan (IDR)</Label>
                <Input
                  id="p-price"
                  type="number"
                  required
                  value={form.priceIdr}
                  onChange={(e) => setForm({ ...form, priceIdr: e.target.value })}
                  placeholder="99000"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="p-ai" className="text-[11px]">
                    Balasan AI
                  </Label>
                  <Input
                    id="p-ai"
                    type="number"
                    value={form.agentReplies}
                    onChange={(e) => setForm({ ...form, agentReplies: e.target.value })}
                    placeholder="1000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-out" className="text-[11px]">
                    Pesan keluar
                  </Label>
                  <Input
                    id="p-out"
                    type="number"
                    value={form.messagesOut}
                    onChange={(e) => setForm({ ...form, messagesOut: e.target.value })}
                    placeholder="5000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-ch" className="text-[11px]">
                    Saluran
                  </Label>
                  <Input
                    id="p-ch"
                    type="number"
                    value={form.channels}
                    onChange={(e) => setForm({ ...form, channels: e.target.value })}
                    placeholder="2"
                  />
                </div>
              </div>
              <dl className="space-y-1 rounded-lg bg-muted px-3 py-2.5 text-[11.5px] text-muted-foreground">
                <div>
                  <dt className="inline font-medium text-foreground">Balasan AI</dt>
                  <dd className="inline">: balasan otomatis agent ke pelanggan.</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-foreground">Pesan keluar</dt>
                  <dd className="inline">
                    : semua pesan keluar, termasuk balasan AI dan pesan staf.
                  </dd>
                </div>
              </dl>
              <p className="text-[11.5px] text-muted-foreground">
                Limit dihitung per bulan. Kosongkan untuk tanpa batas.
              </p>
              {formError && <p className="text-[13px] text-bad">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Btn type="button" variant="line" onClick={() => setShowCreate(false)}>
                  Batal
                </Btn>
                <Btn type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Membuat..." : "Buat paket"}
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
