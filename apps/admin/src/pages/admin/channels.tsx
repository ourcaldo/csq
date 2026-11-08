import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { ChatCircleDots, ArrowsClockwise, XCircle } from "@phosphor-icons/react";

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
      setMsg(`Perintah ${action} dikirim ke worker.`);
      setTimeout(refresh, 3000);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Gagal mengirim perintah.");
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <AdminShell title="Saluran">
      <div className="mx-auto max-w-6xl space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Saluran (Channel Fleet)</h2>
        {msg && <p className="text-sm text-green-700">{msg}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Memuat...</p>}

        {!loading && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lease</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{c.tenantName}</p>
                      <p className="text-xs text-slate-400">{c.tenantSlug}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{c.provider}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.status === "CONNECTED" ? "default" : "secondary"}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.leaseHeld ? (
                        <Badge variant="outline" className="text-xs">HELD</Badge>
                      ) : (
                        <span className="text-xs text-slate-300">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" disabled={busy === c.id}
                          onClick={() => void act(c.id, "reconnect")}>
                          <ArrowsClockwise size={14} />
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy === c.id}
                          onClick={() => void act(c.id, "disconnect")}>
                          <XCircle size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-400">
                      <ChatCircleDots size={24} className="mx-auto mb-2 text-slate-300" />
                      Tidak ada saluran.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
