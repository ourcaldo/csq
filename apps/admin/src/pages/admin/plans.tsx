import { type FormEvent, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { Tag, Warning } from "@phosphor-icons/react";

type Plan = {
  id: string; name: string; priceIdr: number;
  limits: Record<string, number | null>;
  tenantCount: number; createdAt: string;
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
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Paket & Penggunaan</h2>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Tag size={14} className="mr-1.5" /> Paket Baru
          </Button>
        </div>

        {/* Plans */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Paket Tersedia</h3>
          {pLoading && <p className="text-sm text-slate-400">Memuat...</p>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-4">
                <p className="font-semibold text-slate-900">{p.name}</p>
                <p className="text-lg font-bold text-green-700">{formatIdr(p.priceIdr)}<span className="text-xs text-slate-400">/bulan</span></p>
                <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                  {p.limits?.agentRepliesPerMonth ? <p>AI: {p.limits.agentRepliesPerMonth}/bln</p> : <p>AI: unlimited</p>}
                  {p.limits?.messagesOutPerMonth ? <p>Pesan keluar: {p.limits.messagesOutPerMonth}/bln</p> : <p>Pesan: unlimited</p>}
                  {p.limits?.channels ? <p>Saluran: {p.limits.channels}</p> : <p>Saluran: unlimited</p>}
                </div>
                <p className="mt-2 text-xs text-slate-400">{p.tenantCount} tenant</p>
              </div>
            ))}
            {plans.length === 0 && !pLoading && (
              <p className="col-span-3 text-center text-sm text-slate-400">Belum ada paket.</p>
            )}
          </div>
        </Card>

        {/* Usage table */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            Penggunaan Bulan Ini
            {usageData && <span className="ml-2 text-xs text-slate-400">
              (sejak {new Date(usageData.monthStart).toLocaleDateString("id-ID")})
            </span>}
          </h3>
          {uLoading && <p className="text-sm text-slate-400">Memuat...</p>}
          {!uLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead className="text-center">AI Replies</TableHead>
                  <TableHead className="text-center">Outbound</TableHead>
                  <TableHead className="text-center">Inbound</TableHead>
                  <TableHead className="text-center">Storage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((u) => (
                  <TableRow key={u.tenantId}>
                    <TableCell className="font-medium text-slate-900">{u.tenantName}</TableCell>
                    <TableCell>
                      <select
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                        value={u.planId ?? ""}
                        disabled={busy === u.tenantId}
                        onChange={(e) => void assignPlan(u.tenantId, e.target.value || null)}
                      >
                        <option value="">- tanpa paket -</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className="text-center">
                      {u.agentRepliesOver ? (
                        <span className="flex items-center justify-center gap-1">
                          <span className="font-bold text-red-600">{u.agentReplies}</span>
                          <Warning size={12} className="text-red-600" weight="fill" />
                        </span>
                      ) : (
                        <span>{u.agentReplies}{u.agentRepliesLimit ? ` / ${u.agentRepliesLimit}` : ""}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {u.outboundOver ? (
                        <span className="font-bold text-red-600">{u.outbound}</span>
                      ) : (
                        <span>{u.outbound}{u.outboundLimit ? ` / ${u.outboundLimit}` : ""}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{u.inbound}</TableCell>
                    <TableCell className="text-center text-xs">{formatBytes(u.mediaBytes)}</TableCell>
                  </TableRow>
                ))}
                {usage.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-400">
                      Belum ada tenant.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Card>

        {/* Create plan dialog */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md p-6">
              <h3 className="mb-4 text-base font-semibold text-slate-900">Paket Baru</h3>
              <form onSubmit={createPlan} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Nama</label>
                  <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    required value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Starter / Bisnis / Pro" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Harga (IDR/bulan)</label>
                  <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    type="number" required value={form.priceIdr}
                    onChange={(e) => setForm({ ...form, priceIdr: e.target.value })}
                    placeholder="99000" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">AI/bln</label>
                    <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      type="number" value={form.agentReplies}
                      onChange={(e) => setForm({ ...form, agentReplies: e.target.value })}
                      placeholder="1000" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Pesan/bln</label>
                    <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      type="number" value={form.messagesOut}
                      onChange={(e) => setForm({ ...form, messagesOut: e.target.value })}
                      placeholder="5000" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Saluran</label>
                    <input className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
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
            </Card>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
