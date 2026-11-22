import Link from "next/link";
import { Pulse, Plus } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel, StatCell, btnPrimary, btnOutline } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

// Control Plane Overview (template viewOverview 1:1): fleet telemetry strip,
// 30-day throughput chart with the last-3-days highlight, tenant workspaces
// quick ledger. Console copy is English (owner direction 2026-11-13).

type Tenant = { id: string; name: string; slug: string; status: string; createdAt: string; messageCount30d: number };
type Channel = { id: string; status: string };
type Usage = {
  items: { tenantId: string; tenantName: string; planName: string | null }[];
  daily: { date: string; count: number }[];
  monthStart: string;
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AdminOverview() {
  const { data: tenantsData } = useAdminApi<{ items: Tenant[] }>("/api/admin/tenants");
  const { data: channelsData } = useAdminApi<{ items: Channel[] }>("/api/admin/channels");
  const { data: usageData } = useAdminApi<Usage>("/api/admin/usage");

  const tenants = tenantsData?.items ?? [];
  const channels = channelsData?.items ?? [];
  const daily = usageData?.daily ?? [];
  const planById = new Map((usageData?.items ?? []).map((u) => [u.tenantName, u.planName]));
  const connected = channels.filter((c) => c.status === "CONNECTED").length;
  const totalMsgs30d = tenants.reduce((s, t) => s + t.messageCount30d, 0);
  const maxChart = Math.max(...daily.map((d) => d.count), 1);
  const monthStart = usageData
    ? new Date(usageData.monthStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "-";

  return (
    <AdminShell title="Overview">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Control Plane Overview</h1>
          <p className="mt-1 text-xs text-slate-500">
            Multi-tenant fleet telemetry, 30-day message throughput, and infrastructure health across all workspaces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/operations" className={btnOutline()}>
            <Pulse size={14} className="text-emerald-600" />
            System Health
          </Link>
          <Link href="/admin/tenants/new" className={btnPrimary()}>
            <Plus size={14} />
            New Tenant
          </Link>
        </div>
      </div>

      {/* Fleet telemetry strip */}
      <div className="mt-6 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-slate-200">
        <div className="py-3.5 pr-4">
          <p className="text-[11px] font-medium text-slate-400">Active Workspaces</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
            {tenants.filter((t) => t.status === "ACTIVE").length}{" "}
            <span className="text-xs font-normal text-slate-400">/ {tenants.length}</span>
          </p>
        </div>
        <div className="py-3.5 sm:px-5">
          <p className="text-[11px] font-medium text-slate-400">Connected Channels</p>
          <p className="mt-1 font-mono text-lg font-semibold text-emerald-700 tabular-nums">
            {connected} <span className="text-xs font-normal text-slate-400">/ {channels.length}</span>
          </p>
        </div>
        <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-5">
          <p className="text-[11px] font-medium text-slate-400">30d Message Volume</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
            {totalMsgs30d.toLocaleString("en-GB")}
          </p>
        </div>
        <div className="border-t border-slate-200 py-3.5 sm:border-t-0 sm:pl-5">
          <p className="text-[11px] font-medium text-slate-400">Cycle Start</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">{monthStart}</p>
        </div>
      </div>

      {/* 30-day throughput chart */}
      <div className="border-b border-slate-200 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              30-Day Outbound &amp; AI Message Throughput
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Daily message volume aggregated across all active WhatsApp Cloud API &amp; Baileys sockets.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500">
            Peak: <strong className="text-slate-900">{maxChart}</strong> msgs/day
          </span>
        </div>
        <div className="mt-4 flex h-24 items-end gap-1 pt-2">
          {daily.map((d, idx) => {
            const pct = Math.max(8, Math.round((d.count / maxChart) * 100));
            const isRecent = idx >= daily.length - 3;
            return (
              <div
                key={d.date}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`${d.date}: ${d.count} messages`}
              >
                <div
                  className={`w-full rounded-sm transition-colors ${
                    isRecent ? "bg-emerald-600 group-hover:bg-emerald-700" : "bg-slate-200 group-hover:bg-emerald-500"
                  }`}
                  style={{ height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-400">
          <span>30 days ago</span>
          <span>15 days ago</span>
          <span>Today</span>
        </div>
      </div>

      {/* Tenant workspaces quick ledger */}
      <div className="pt-6">
        <div className="flex items-center justify-between pb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Tenant Workspaces ({tenants.length})
          </h2>
          <Link href="/admin/tenants" className="text-xs font-semibold text-emerald-700 hover:underline">
            Manage All Tenants →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-2.5 pr-4">Workspace</th>
                <th className="px-4 py-2.5">Plan</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">30d Msgs</th>
                <th className="py-2.5 pl-4 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {tenants.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-slate-900">{t.name}</p>
                    <p className="font-mono text-[11px] text-slate-400">{t.slug}</p>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">{planById.get(t.name) ?? "None"}</td>
                  <td className="px-4 py-3">
                    <StatusLabel tone={t.status === "ACTIVE" ? "ok" : "bad"}>
                      {t.status === "ACTIVE" ? "Active" : "Suspended"}
                    </StatusLabel>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-800 tabular-nums">
                    {t.messageCount30d.toLocaleString("en-GB")}
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <Link href={`/admin/tenants/${t.id}`} className="font-semibold text-emerald-700 hover:underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
