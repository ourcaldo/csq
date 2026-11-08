import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { ArrowsClockwise, XCircle, CheckCircle, ChatCircleDots } from "@phosphor-icons/react";

type Channel = {
  id: string; tenantName: string; tenantSlug: string; tenantStatus: string;
  provider: string; type: string; status: string;
  leaseHeld: boolean; leaseUntil: string | null;
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
      setMsg(`Perintah ${action} dikirim - worker akan memproses dalam 2 detik.`);
      setTimeout(refresh, 4000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Gagal mengirim perintah.");
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];
  const connected = items.filter((c) => c.status === "CONNECTED").length;
  const disconnected = items.filter((c) => c.status !== "CONNECTED").length;

  return (
    <AdminShell title="Saluran">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-2">
            <CheckCircle size={14} className="text-green-600" weight="fill" />
            <span className="text-sm font-bold text-green-700">{connected} Terhubung</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2">
            <XCircle size={14} className="text-slate-400" />
            <span className="text-sm font-bold text-slate-500">{disconnected} Terputus</span>
          </div>
        </div>

        {msg && <Card className="border-green-200 bg-green-50 p-3"><p className="text-sm text-green-700">{msg}</p></Card>}
        {error && <Card className="border-red-200 bg-red-50 p-3"><p className="text-sm text-red-700">{error}</p></Card>}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse p-5"><div className="h-5 w-48 rounded bg-slate-200" /></Card>)}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="space-y-3">
            {items.map((c) => (
              <Card key={c.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className={`flex h-12 w-12 items-center justify-center rounded-xl shadow-sm ${
                      c.provider === "BAILEYS" ? "bg-gradient-to-br from-violet-500 to-violet-700" : "bg-gradient-to-br from-blue-500 to-blue-700"
                    } text-white`}>
                      <ChatCircleDots size={22} />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{c.tenantName}</p>
                        <Badge variant={c.status === "CONNECTED" ? "default" : "secondary"} className="text-[10px] font-bold uppercase">
                          {c.status}
                        </Badge>
                        {c.leaseHeld && (
                          <Badge variant="outline" className="border-green-200 bg-green-50 text-[10px] font-bold text-green-700 uppercase">
                            Lease Held
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        {c.provider} / {c.type} / {c.tenantSlug}
                        {c.tenantStatus === "SUSPENDED" && <span className="ml-1 text-red-500">(tenant suspended)</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={busy === c.id}
                      onClick={() => void act(c.id, "reconnect")}
                      className="border-green-200 text-green-700 hover:bg-green-50">
                      <ArrowsClockwise size={14} className="mr-1" /> Reconnect
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy === c.id}
                      onClick={() => void act(c.id, "disconnect")}
                      className="border-red-200 text-red-600 hover:bg-red-50">
                      <XCircle size={14} className="mr-1" /> Disconnect
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {!loading && items.length === 0 && (
          <Card className="flex flex-col items-center py-16">
            <ChatCircleDots size={40} className="mb-3 text-slate-200" />
            <p className="text-sm text-slate-400">Tidak ada saluran di seluruh tenant</p>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
