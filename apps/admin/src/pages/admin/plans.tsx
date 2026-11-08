import { type FormEvent, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Tag, Plus, Warning, X, Sparkle } from "@phosphor-icons/react";

type Plan = {
  id: string; name: string; priceIdr: number;
  limits: Record<string, number | null>;
  tenantCount: number;
};
type PlanList = { items: Plan[] };
type UsageItem = {
  tenantId: string; tenantName: string;
  planName: string | null; planId: string | null;
  agentReplies: number; agentRepliesLimit: number | null; agentRepliesOver: boolean;
  outbound: number; outboundLimit: number | null; outboundOver: boolean;
  inbound: number; channelCount: number; mediaBytes: number;
};
type UsageData = { items: UsageItem[]; monthStart: string };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function formatIdr(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function PlansPage() {
  const { data: plansData, loading: pLoading, refresh: refreshPlans } = useAdminApi<PlanList>("/api/admin/plans");
  const { data: usageData, loading: uLoading } = useAdminApi<UsageData>("/api/admin/usage");
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", priceIdr: "0", agentReplies: "", messagesOut: "", channels: "" });
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
      setForm({ name: "", priceIdr: "0", agentReplies: "", messagesOut: "", channels: "" });
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
      <div className="space-y-8">
        {/* Plans */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-600">Paket Tersedia</h3>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={14} className="mr-1.5" /> Paket Baru
            </Button>
          </div>
          {pLoading && <Card className="animate-pulse p-6"><div className="h-6 w-32 rounded bg-slate-200" /></Card>}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <Card key={p.id} className="relative overflow-hidden">
                <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-full bg-gradient-to-br from-green-50 to-transparent" />
                <div className="p-5">
                  <Badge variant="outline" className="mb-2 text-[9px] font-bold uppercase tracking-wide text-green-700">
                    <Sparkle size={8} className="mr-1" weight="fill" /> Paket
                  </Badge>
                  <p className="text-lg font-bold text-slate-900">{p.name}</p>
                  <p className="text-2xl font-bold text-green-700">
                    {formatIdr(p.priceIdr)}
                    <span className="text-xs font-normal text-slate-400">/bulan</span>
                  </p>
                  <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <p className="flex justify-between">
                      <span>AI replies</span>
                      <span className="font-semibold">{p.limits?.agentRepliesPerMonth ?? "∞"}</span>
                    </p>
                    <p className="flex justify-between">
                      <span>Pesan keluar</span>
                      <span className="font-semibold">{p.limits?.messagesOutPerMonth ?? "∞"}</span>
                    </p>
                    <p className="flex justify-between">
                      <span>Saluran</span>
                      <span className="font-semibold">{p.limits?.channels ?? "∞"}</span>
                    </p>
                  </div>
                  <p className="mt-3 rounded-lg bg-slate-50 px-2 py-1 text-center text-[10px] font-medium text-slate-400">
                    {p.tenantCount} tenant aktif
                  </p>
                </div>
              </Card>
            ))}
            {plans.length === 0 && !pLoading && (
              <Card className="col-span-3 flex flex-col items-center py-10">
                <Tag size={32} className="mb-2 text-slate-200" />
                <p className="text-sm text-slate-400">Belum ada paket - buat paket pertama</p>
              </Card>
            )}
          </div>
        </div>

        {/* Usage table */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-600">Penggunaan Bulan Ini</h3>
            {usageData && (
              <p className="text-xs text-slate-400">
                Sejak {new Date(usageData.monthStart).toLocaleDateString("id-ID", { day: "numeric", month: "long" })}
              </p>
            )}
          </div>
          {uLoading && <Card className="animate-pulse p-6"><div className="h-5 w-full rounded bg-slate-200" /></Card>}
          {!uLoading && usage.length > 0 && (
            <Card className="overflow-hidden">
              <div className="divide-y divide-slate-50">
                {usage.map((u) => (
                  <div key={u.tenantId} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50/50">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">
                      {u.tenantName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">{u.tenantName}</p>
                      <select
                        className="mt-0.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500"
                        value={u.planId ?? ""}
                        disabled={busy === u.tenantId}
                        onChange={(e) => void assignPlan(u.tenantId, e.target.value || null)}
                      >
                        <option value="">- tanpa paket -</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    {/* AI replies */}
                    <div className={`shrink-0 rounded-xl px-3 py-1.5 text-center ${u.agentRepliesOver ? "bg-red-50" : "bg-slate-50"}`}>
                      <p className={`text-sm font-bold ${u.agentRepliesOver ? "text-red-600" : "text-slate-700"}`}>
                        {u.agentReplies}
                        {u.agentRepliesOver && <Warning size={10} className="ml-0.5 inline text-red-500" weight="fill" />}
                      </p>
                      <p className="text-[9px] uppercase text-slate-400">
                        AI{u.agentRepliesLimit ? `/${u.agentRepliesLimit}` : ""}
                      </p>
                    </div>
                    {/* Outbound */}
                    <div className={`shrink-0 rounded-xl px-3 py-1.5 text-center ${u.outboundOver ? "bg-red-50" : "bg-slate-50"}`}>
                      <p className={`text-sm font-bold ${u.outboundOver ? "text-red-600" : "text-slate-700"}`}>{u.outbound}</p>
                      <p className="text-[9px] uppercase text-slate-400">
                        Out{u.outboundLimit ? `/${u.outboundLimit}` : ""}
                      </p>
                    </div>
                    {/* Inbound */}
                    <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-1.5 text-center">
                      <p className="text-sm font-bold text-slate-700">{u.inbound}</p>
                      <p className="text-[9px] uppercase text-slate-400">In</p>
                    </div>
                    {/* Storage */}
                    <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-1.5 text-center">
                      <p className="text-sm font-bold text-slate-700">{formatBytes(u.mediaBytes)}</p>
                      <p className="text-[9px] uppercase text-slate-400">Media</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {!uLoading && usage.length === 0 && (
            <Card className="flex flex-col items-center py-10">
              <p className="text-sm text-slate-400">Belum ada tenant</p>
            </Card>
          )}
        </div>
      </div>

      {/* Create plan dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md overflow-hidden shadow-2xl">
            <div className="h-1.5 bg-gradient-to-r from-green-500 to-green-700" />
            <div className="p-6">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">Paket Baru</h3>
                <button onClick={() => setShowCreate(false)} className="text-slate-300 hover:text-slate-500">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={createPlan} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Nama Paket</label>
                  <input className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-green-300 focus:outline-none focus:ring-2 focus:ring-green-100"
                    required value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Starter / Bisnis / Pro" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Harga (IDR/bulan)</label>
                  <input className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-green-300 focus:outline-none focus:ring-2 focus:ring-green-100"
                    type="number" required value={form.priceIdr}
                    onChange={(e) => setForm({ ...form, priceIdr: e.target.value })}
                    placeholder="99000" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <label className="text-[10px] font-semibold uppercase text-slate-400">AI/bln</label>
                    <input className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      type="number" value={form.agentReplies}
                      onChange={(e) => setForm({ ...form, agentReplies: e.target.value })}
                      placeholder="1000" />
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <label className="text-[10px] font-semibold uppercase text-slate-400">Pesan/bln</label>
                    <input className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      type="number" value={form.messagesOut}
                      onChange={(e) => setForm({ ...form, messagesOut: e.target.value })}
                      placeholder="5000" />
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <label className="text-[10px] font-semibold uppercase text-slate-400">Saluran</label>
                    <input className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      type="number" value={form.channels}
                      onChange={(e) => setForm({ ...form, channels: e.target.value })}
                      placeholder="2" />
                  </div>
                </div>
                <p className="text-xs text-slate-400">Kosongkan limit untuk unlimited.</p>
                {formError && <p className="text-sm text-red-600">{formError}</p>}
                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={busy === "create"} className="flex-1">
                    {busy === "create" ? "Membuat..." : "Buat Paket"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Batal</Button>
                </div>
              </form>
            </div>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
