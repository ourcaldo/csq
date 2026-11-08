import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";
import { Gear, ArrowClockwise } from "@phosphor-icons/react";

type Ops = {
  locks: { key: string; lockedUntil: string; isHeld: boolean; updatedAt: string }[];
  outbox: { status: string; count: number }[];
  failedMessages: { id: string; tenantId: string; toJid: string; error: string | null; updatedAt: string }[];
  commands: { id: string; kind: string; status: string; channelId: string; provider: string; createdAt: string }[];
  sources: { id: string; name: string; lastSyncAt: string | null; tenantId: string }[];
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function OperationsPage() {
  const { data, loading, error, refresh } = useAdminApi<Ops>("/api/admin/operations");
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(messageId: string) {
    setBusy(messageId);
    try {
      await adminFetch("/api/admin/operations", "POST", { messageId });
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const outboxMap = new Map((data?.outbox ?? []).map((o) => [o.status, o.count]));

  return (
    <AdminShell title="Operasional">
      <div className="mx-auto max-w-6xl space-y-6">
        <h2 className="text-lg font-semibold text-slate-900">Operasional</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Memuat...</p>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {["QUEUED", "SENDING", "SENT", "FAILED"].map((s) => (
            <Card key={s} className="p-4">
              <p className="text-2xl font-bold text-slate-900">{outboxMap.get(s) ?? 0}</p>
              <p className="text-xs text-slate-400">{s}</p>
            </Card>
          ))}
        </div>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">System Locks</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kunci</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Diperbarui</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.locks ?? []).map((l) => (
                <TableRow key={l.key}>
                  <TableCell><code className="text-xs">{l.key}</code></TableCell>
                  <TableCell>
                    <Badge variant={l.isHeld ? "default" : "secondary"}>
                      {l.isHeld ? "HELD" : "EXPIRED"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {new Date(l.updatedAt).toLocaleString("id-ID")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {(data?.failedMessages ?? []).length > 0 && (
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Pesan Gagal (FAILED)</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tujuan</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.failedMessages ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{m.toJid}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-red-600">{m.error}</TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {new Date(m.updatedAt).toLocaleString("id-ID")}
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" disabled={busy === m.id}
                        onClick={() => void retry(m.id)}>
                        <ArrowClockwise size={14} className="mr-1" /> Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Perintah Channel Terbaru</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jenis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Waktu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.commands ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Badge variant="outline">{c.kind}</Badge></TableCell>
                  <TableCell><Badge variant={c.status === "DONE" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                  <TableCell className="text-xs">{c.provider}</TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {new Date(c.createdAt).toLocaleString("id-ID")}
                  </TableCell>
                </TableRow>
              ))}
              {(data?.commands ?? []).length === 0 && (
                <TableRow><TableCell colSpan={4} className="py-4 text-center text-sm text-slate-400">
                  <Gear size={20} className="mx-auto mb-1 text-slate-300" />
                  Tidak ada perintah.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Sinkronisasi Sheets</h3>
          {(data?.sources ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">Tidak ada sumber Google Sheets aktif.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Sinkron Terakhir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.sources ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">{s.name}</TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString("id-ID") : "Belum pernah"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
