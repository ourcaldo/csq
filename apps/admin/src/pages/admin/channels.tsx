import { useState } from "react";
import { ArrowsClockwise, Power } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, PageHead, Status, TableCard, Tag } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Channel fleet (PRD 13 Phase 3). Console copy is English (owner direction
// 2026-11-13).

type Channel = {
  id: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  provider: string;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  leaseHeld: boolean;
  leaseUntil: string | null;
  leaseToken: string | null;
  leaseUpdatedAt: string | null;
};
type ChannelList = { items: Channel[] };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChannelsPage() {
  const { data, loading, error, refresh } = useAdminApi<ChannelList>("/api/admin/channels");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(channelId: string, action: "reconnect" | "disconnect") {
    setBusy(channelId);
    setMsg(null);
    try {
      await adminFetch("/api/admin/channels", "POST", { channelId, action });
      setMsg(`${action} command sent. The worker picks it up within 2 seconds.`);
      setTimeout(refresh, 4000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to send the command.");
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];
  const connected = items.filter((c) => c.status === "CONNECTED").length;

  return (
    <AdminShell title="Channels">
      <PageHead
        eyebrow="Platform"
        title="Channels"
        sub={`Channel fleet - ${connected} of ${items.length} connected`}
      />

      {msg && (
        <div className="mb-4 rounded-xl border border-border bg-card px-5 py-3 text-[13px]">
          {msg}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}

      <TableCard>
        <table className="ledger">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Provider</th>
              <th>Type</th>
              <th>Status</th>
              <th>Lease</th>
              <th>Until</th>
              <th>Last activity</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="font-medium">{c.tenantName}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {c.tenantSlug}
                    {c.tenantStatus === "SUSPENDED" && " / suspended"}
                  </div>
                </td>
                <td>
                  <Tag>{c.provider}</Tag>
                </td>
                <td className="text-[13px] text-muted-foreground">{c.type}</td>
                <td>
                  <Status
                    tone={
                      c.status === "CONNECTED"
                        ? "ok"
                        : c.status === "CONNECTING"
                          ? "warn"
                          : "bad"
                    }
                  >
                    {c.status}
                  </Status>
                </td>
                <td>
                  <span className="flex items-center gap-1.5 text-[13px]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        c.leaseHeld ? "bg-ok live" : "bg-muted-foreground/40"
                      }`}
                    />
                    {c.leaseHeld ? "Held" : "Free"}
                  </span>
                  {c.leaseToken && c.leaseUpdatedAt && (
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      #{c.leaseToken.slice(0, 8)}, updated {ago(c.leaseUpdatedAt)}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                  {c.leaseUntil
                    ? new Date(c.leaseUntil).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "-"}
                </td>
                <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                  {when(c.updatedAt)}
                </td>
                <td className="text-right">
                  <Btn
                    variant="ghost"
                    disabled={busy === c.id}
                    onClick={() => void act(c.id, "reconnect")}
                    aria-label={`Reconnect ${c.tenantName}`}
                    className="px-2.5"
                  >
                    <ArrowsClockwise size={14} />
                  </Btn>
                  <Btn
                    variant="ghost"
                    disabled={busy === c.id}
                    onClick={() => void act(c.id, "disconnect")}
                    aria-label={`Disconnect ${c.tenantName}`}
                    className="px-2.5 hover:text-bad"
                  >
                    <Power size={14} />
                  </Btn>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-[13px] text-muted-foreground">
                  No channels across any tenant.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-[13px] text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableCard>
    </AdminShell>
  );
}
