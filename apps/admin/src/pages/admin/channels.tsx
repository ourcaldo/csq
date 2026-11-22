import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel, btnSmOutline } from "@/components/console";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Channel fleet (template viewChannels 1:1): socket lease telemetry,
// reconnect/disconnect dispatch to the worker via ChannelCommand.

type Channel = {
  id: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  label: string;
  phoneNumber: string | null;
  wabaId: string | null;
  provider: string;
  type: string;
  status: string;
  leaseHeld: boolean;
  leaseUntil: string | null;
  leaseToken: string | null;
  updatedAt: string;
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function ChannelsPage() {
  const { data, loading, error, refresh } = useAdminApi<{ items: Channel[] }>("/api/admin/channels");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = data?.items ?? [];
  const connected = items.filter((c) => c.status === "CONNECTED").length;

  async function act(id: string, action: "reconnect" | "disconnect") {
    setBusy(id);
    setMsg(null);
    setActionError(null);
    try {
      await adminFetch("/api/admin/channels", "POST", { channelId: id, action });
      setMsg(`Dispatched "${action}" command. The worker polls the command queue within 2 seconds.`);
      showToast(`Command "${action}" queued`);
      setTimeout(refresh, 4000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send the command.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Channels">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Channel Fleet</h1>
          <p className="mt-1 text-xs text-slate-500">
            Monitor Baileys socket leases, Cloud API connections, and dispatch worker reconnect commands.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-600">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {connected} / {items.length} Connected
        </span>
      </div>

      {msg && (
        <div className="mt-5 rounded-md border border-slate-200 bg-muted/80 px-4 py-2.5 text-xs text-slate-800">
          {msg}
        </div>
      )}
      {(actionError || error) && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {actionError ?? error}
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-3 pr-4">Tenant</th>
              <th className="px-4 py-3">Channel &amp; Number</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Connection</th>
              <th className="px-4 py-3">Worker Lease</th>
              <th className="hidden px-4 py-3 md:table-cell">Last Activity</th>
              <th className="py-3 pl-4 text-right">Control</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 border-b border-slate-200">
            {loading && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50/80">
                <td className="py-3.5 pr-4">
                  <p className="text-xs font-semibold text-slate-900">{c.tenantName}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                    {c.tenantSlug}
                    {c.tenantStatus === "SUSPENDED" ? " - suspended" : ""}
                  </p>
                </td>
                <td className="px-4 py-3.5">
                  <p className="text-xs font-medium text-slate-800">{c.label}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                    {c.phoneNumber ?? "No phone"}
                    {c.wabaId ? ` - WABA ${c.wabaId}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3.5">
                  <span className="rounded border border-slate-200 bg-muted px-2 py-0.5 font-mono text-[11px] text-slate-700">
                    {c.provider}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <StatusLabel
                    tone={c.status === "CONNECTED" ? "ok" : c.status === "CONNECTING" ? "warn" : "bad"}
                  >
                    {c.status}
                  </StatusLabel>
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className={`inline-flex items-center gap-1.5 font-mono text-xs ${
                      c.leaseHeld ? "text-emerald-700" : "text-slate-400"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${c.leaseHeld ? "live-dot bg-emerald-500" : "bg-slate-300"}`}
                    />
                    {c.leaseHeld
                      ? `Held (until ${c.leaseUntil ? new Date(c.leaseUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "-"})`
                      : "Free"}
                  </span>
                  {c.leaseToken && (
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">token #{c.leaseToken.slice(0, 8)}</p>
                  )}
                </td>
                <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-500 md:table-cell">
                  {new Date(c.updatedAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-3.5 pl-4 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => void act(c.id, "reconnect")}
                      className={btnSmOutline()}
                    >
                      Reconnect
                    </button>
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => void act(c.id, "disconnect")}
                      className={btnSmOutline("text-red-600 hover:bg-red-50")}
                    >
                      Disconnect
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                  No channels across any tenant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
