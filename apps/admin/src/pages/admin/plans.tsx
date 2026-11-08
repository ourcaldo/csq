import { type FormEvent, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Plus, X } from "@phosphor-icons/react";

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
    <AdminShell title="Paket & penggunaan">
      <div className="space-y-6">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-slate-900">Paket</h2>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
              <Plus size={14} weight="bold" className="mr-1.5" />
              Paket baru
            </Button>
          </div>

          <div className="panel overflow-hidden">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th className="text-right">Harga / bulan</th>
                  <th className="text-right">AI replies</th>
                  <th className="text-right">Pesan keluar</th>
                  <th className="text-right">Saluran</th>
                  <th className="text-right">Tenant</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium text-slate-900">{p.name}</td>
                    <td className="text-right tabular-nums">{idr(p.priceIdr)}</td>
                    <td className="text-right tabular-nums">
                      {limit(p.limits?.agentRepliesPerMonth)}
                    </td>
                    <td className="text-right tabular-nums">
                      {limit(p.limits?.messagesOutPerMonth)}
                    </td>
                    <td className="text-right tabular-nums">{limit(p.limits?.channels)}</td>
                    <td className="text-right tabular-nums">{p.tenantCount}</td>
                  </tr>
                ))}
                {!pLoading && plans.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[13px] text-slate-400">
                      Belum ada paket.
                    </td>
                  </tr>
                )}
                {pLoading && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[13px] text-slate-400">
                      Memuat...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-slate-900">Penggunaan bulan ini</h2>
            {usageData && (
              <p className="text-[11px] text-slate-400">
                Sejak{" "}
                {new Date(usageData.monthStart).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "long",
                })}
              </p>
            )}
          </div>

          <div className="panel overflow-hidden">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Paket</th>
                  <th className="text-right">AI replies</th>
                  <th className="text-right">Keluar</th>
                  <th className="text-right">Masuk</th>
                  <th className="text-right">Media</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.tenantId}>
                    <td>
                      <p className="font-medium text-slate-900">{u.tenantName}</p>
                      <p className="text-[11px] text-slate-400">{u.channelCount} saluran</p>
                    </td>
                    <td>
                      <select
                        className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[12px] text-slate-600"
                        value={u.planId ?? ""}
                        disabled={busy === u.tenantId}
                        onChange={(e) => void assignPlan(u.tenantId, e.target.value || null)}
                      >
                        <option value="">Tanpa paket</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td
                      className={`text-right tabular-nums ${
                        u.agentRepliesOver ? "font-medium text-red-600" : ""
                      }`}
                    >
                      {u.agentReplies}
                      {u.agentRepliesLimit ? ` / ${u.agentRepliesLimit}` : ""}
                    </td>
                    <td
                      className={`text-right tabular-nums ${
                        u.outboundOver ? "font-medium text-red-600" : ""
                      }`}
                    >
                      {u.outbound}
                      {u.outboundLimit ? ` / ${u.outboundLimit}` : ""}
                    </td>
                    <td className="text-right tabular-nums">{u.inbound}</td>
                    <td className="text-right tabular-nums">{bytes(u.mediaBytes)}</td>
                  </tr>
                ))}
                {!uLoading && usage.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[13px] text-slate-400">
                      Belum ada tenant.
                    </td>
                  </tr>
                )}
                {uLoading && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[13px] text-slate-400">
                      Memuat...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-4 pt-16">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="text-[14px] font-semibold text-slate-900">Paket baru</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="text-slate-400 hover:text-slate-700"
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
                    AI / bulan
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
                    Pesan / bulan
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
              <p className="text-[11px] text-slate-400">
                Kosongkan limit untuk tanpa batas.
              </p>
              {formError && <p className="text-[13px] text-red-600">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  Batal
                </Button>
                <Button type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Membuat..." : "Buat paket"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
