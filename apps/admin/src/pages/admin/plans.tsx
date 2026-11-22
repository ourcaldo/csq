import { useState } from "react";
import Link from "next/link";
import { Plus } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { idr, bytes, btnPrimary } from "@/components/console";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Plans & quota utilization (template viewPlans 1:1): tier catalog + current
// cycle consumption with inline per-tenant plan assignment. The editor lives
// at /admin/plans/new and /admin/plans/edit/[id].

type Plan = {
  id: string;
  name: string;
  priceIdr: number;
  aiCreditsPerMonth: number | null;
  mauLimit: number | null;
  staffLimit: number | null;
  channelLimit: number | null;
  features: string[];
};
type UsageItem = {
  tenantId: string;
  tenantName: string;
  planId: string | null;
  mau: number;
  mauLimit: number | null;
  creditsUsed: number;
  creditsLimit: number | null;
  staff: number;
  staffLimit: number | null;
  channelCount: number;
  channelLimit: number | null;
  mediaBytes: number;
};

function limitLabel(v: number | null): string {
  return v === null ? "∞" : v.toLocaleString("en-GB");
}

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function PlansPage() {
  const { data: plansData, refresh: refreshPlans } = useAdminApi<{ items: Plan[] }>("/api/admin/plans");
  const { data: usageData, refresh: refreshUsage } = useAdminApi<{ items: UsageItem[]; monthStart: string }>(
    "/api/admin/usage"
  );
  const [busy, setBusy] = useState<string | null>(null);

  const plans = plansData?.items ?? [];
  const usage = usageData?.items ?? [];

  async function assignPlan(tenantId: string, tenantName: string, planId: string) {
    setBusy(tenantId);
    try {
      await adminFetch("/api/admin/plans", "PATCH", { tenantId, planId: planId || null });
      const planName = plans.find((p) => p.id === planId)?.name;
      showToast(planName ? `Assigned ${planName} to ${tenantName}` : `Cleared plan for ${tenantName}`);
      refreshPlans();
      refreshUsage();
    } finally {
      setBusy(null);
    }
  }

  const monthLabel = usageData
    ? new Date(usageData.monthStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";

  return (
    <AdminShell title="Plans & Usage">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Plans &amp; Quota Utilization</h1>
          <p className="mt-1 text-xs text-slate-500">
            Define subscription tier limits, feature entitlements, and inspect real-time monthly consumption per tenant.
          </p>
        </div>
        <Link href="/admin/plans/new" className={btnPrimary()}>
          <Plus size={14} />
          New Plan Tier
        </Link>
      </div>

      <div className="mt-6">
        <h2 className="pb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Subscription Catalog ({plans.length} Tiers)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 pr-4">Tier Name</th>
                <th className="px-3 py-3 text-right">Monthly Price</th>
                <th className="px-3 py-3 text-right">AI Credits</th>
                <th className="px-3 py-3 text-right">MAU</th>
                <th className="px-3 py-3 text-right">Staff / Channels</th>
                <th className="px-3 py-3">Included Modules</th>
                <th className="py-3 pl-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {plans.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80">
                  <td className="py-3.5 pr-4 font-semibold text-slate-900">{p.name}</td>
                  <td className="px-3 py-3.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {idr(p.priceIdr)}
                  </td>
                  <td className="px-3 py-3.5 text-right font-mono text-slate-700 tabular-nums">
                    {limitLabel(p.aiCreditsPerMonth)}
                  </td>
                  <td className="px-3 py-3.5 text-right font-mono text-slate-700 tabular-nums">
                    {limitLabel(p.mauLimit)}
                  </td>
                  <td className="px-3 py-3.5 text-right font-mono text-slate-700 tabular-nums">
                    {limitLabel(p.staffLimit)} / {limitLabel(p.channelLimit)}
                  </td>
                  <td className="px-3 py-3.5 text-slate-500">{p.features.join(", ")}</td>
                  <td className="py-3.5 pl-3 text-right">
                    <Link
                      href={`/admin/plans/edit/${p.id}`}
                      className="font-medium text-slate-700 hover:text-slate-950"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="pb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Current Cycle Consumption (Since {monthLabel})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 pr-4">Tenant Workspace</th>
                <th className="px-3 py-3">Assigned Tier</th>
                <th className="px-3 py-3 text-right">MAU</th>
                <th className="px-3 py-3 text-right">AI Credits</th>
                <th className="px-3 py-3 text-right">Staff / Channels</th>
                <th className="px-3 py-3 text-right">Media Storage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {usage.map((u) => (
                <tr key={u.tenantId} className="hover:bg-slate-50/80">
                  <td className="py-3.5 pr-4 font-semibold text-slate-900">{u.tenantName}</td>
                  <td className="px-3 py-3.5">
                    <select
                      disabled={busy === u.tenantId}
                      onChange={(e) => void assignPlan(u.tenantId, u.tenantName, e.target.value)}
                      defaultValue={usage.find((x) => x.tenantId === u.tenantId)?.planId ?? ""}
                      className="h-7 rounded border border-slate-300 bg-card px-2 text-xs text-slate-800 focus:border-emerald-600 focus:outline-none"
                    >
                      <option value="">- No Plan -</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                    {u.mau.toLocaleString("en-GB")}
                    {u.mauLimit !== null && <span className="text-slate-400"> / {u.mauLimit.toLocaleString("en-GB")}</span>}
                  </td>
                  <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                    {u.creditsUsed.toLocaleString("en-GB")}
                    {u.creditsLimit !== null && (
                      <span className="text-slate-400"> / {u.creditsLimit.toLocaleString("en-GB")}</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                    {u.staff}/{u.staffLimit ?? "∞"} - {u.channelCount}/{u.channelLimit ?? "∞"}
                  </td>
                  <td className="px-3 py-3.5 text-right font-mono text-slate-600 tabular-nums">{bytes(u.mediaBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
