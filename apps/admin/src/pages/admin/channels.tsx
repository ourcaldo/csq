import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusDot } from "@/components/status-dot";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

type Channel = {
  id: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  provider: string;
  type: string;
  status: string;
  leaseHeld: boolean;
  leaseUntil: string | null;
};
type ChannelList = { items: Channel[] };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function ChannelsPage() {
  const { data, loading, error, refresh } = useAdminApi<ChannelList>("/api/admin/channels");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(channelId: string, action: "reconnect" | "disconnect") {
    setBusy(channelId);
    setMsg(null);
    try {
      await adminFetch("/api/admin/channels", "POST", { channelId, action });
      setMsg(`Perintah ${action} dikirim. Worker memproses dalam 2 detik.`);
      setTimeout(refresh, 4000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Gagal mengirim perintah.");
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];
  const connected = items.filter((c) => c.status === "CONNECTED").length;

  return (
    <AdminShell title="Saluran">
      <div className="space-y-4">
        <p className="text-[13px] text-slate-500">
          {connected} terhubung, {items.length - connected} terputus dari {items.length} saluran.
        </p>

        {msg && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-700">
            {msg}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-slate-200 border-l-2 border-l-red-600 bg-white px-4 py-2.5 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="panel overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Provider</th>
                <th>Tipe</th>
                <th>Status</th>
                <th>Lease</th>
                <th>Berakhir</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <p className="font-medium text-slate-900">{c.tenantName}</p>
                    <p className="text-[11px] text-slate-400">
                      {c.tenantSlug}
                      {c.tenantStatus === "SUSPENDED" && " / ditangguhkan"}
                    </p>
                  </td>
                  <td>{c.provider}</td>
                  <td>{c.type}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <StatusDot
                        tone={
                          c.status === "CONNECTED"
                            ? "ok"
                            : c.status === "CONNECTING"
                              ? "warn"
                              : "idle"
                        }
                      />
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone={c.leaseHeld ? "ok" : "idle"} />
                      {c.leaseHeld ? "Held" : "Free"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-slate-500">
                    {c.leaseUntil
                      ? new Date(c.leaseUntil).toLocaleTimeString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "-"}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button
                      disabled={busy === c.id}
                      onClick={() => void act(c.id, "reconnect")}
                      className="text-[12px] font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                    >
                      Reconnect
                    </button>
                    <span className="mx-2 text-slate-200">|</span>
                    <button
                      disabled={busy === c.id}
                      onClick={() => void act(c.id, "disconnect")}
                      className="text-[12px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[13px] text-slate-400">
                    Tidak ada saluran di seluruh tenant.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[13px] text-slate-400">
                    Memuat...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
