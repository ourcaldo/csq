import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { ArrowClockwise, Lock, Gear, Database, Warning } from "@phosphor-icons/react";

type Ops = {
  locks: { key: string; lockedUntil: string; isHeld: boolean; updatedAt: string }[];
  outbox: { status: string; count: number }[];
  failedMessages: { id: string; tenantId: string; toJid: string; error: string | null; updatedAt: string }[];
  commands: { id: string; kind: string; status: string; channelId: string; provider: string; createdAt: string }[];
  sources: { id: string; name: string; lastSyncAt: string | null; tenantId: string }[];
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function QueueCard({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className={`rounded-2xl p-4 text-center ${tone}`}>
      <p className="text-3xl font-bold">{count}</p>
      <p className="text-[10px] font-semibold uppercase tracking-widest">{label}</p>
    </div>
  );
}

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
      <div className="space-y-8">
        {/* Outbox summary */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-600">Outbox Worker</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <QueueCard label="Queued" count={outboxMap.get("QUEUED") ?? 0} tone="bg-amber-50 text-amber-700" />
            <QueueCard label="Sending" count={outboxMap.get("SENDING") ?? 0} tone="bg-blue-50 text-blue-700" />
            <QueueCard label="Sent" count={outboxMap.get("SENT") ?? 0} tone="bg-green-50 text-green-700" />
            <QueueCard label="Failed" count={outboxMap.get("FAILED") ?? 0} tone="bg-red-50 text-red-700" />
          </div>
        </div>

        {/* Failed messages */}
        {(data?.failedMessages ?? []).length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Warning size={16} className="text-red-500" weight="fill" />
              <h3 className="text-sm font-semibold text-red-700">Pesan Gagal ({data?.failedMessages.length})</h3>
            </div>
            <div className="space-y-2">
              {(data?.failedMessages ?? []).map((m) => (
                <Card key={m.id} className="flex items-center justify-between border-red-100 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700">{m.toJid}</p>
                    <p className="truncate text-xs text-red-500">{m.error}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy === m.id}
                    onClick={() => void retry(m.id)}
                    className="ml-3 border-amber-200 text-amber-700 hover:bg-amber-50">
                    <ArrowClockwise size={14} className="mr-1" /> Retry
                  </Button>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Locks */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Lock size={16} className="text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-600">System Locks</h3>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(data?.locks ?? []).map((l) => (
              <Card key={l.key} className={`p-4 ${l.isHeld ? "border-green-200 bg-green-50/50" : ""}`}>
                <div className="flex items-center justify-between">
                  <code className="text-xs font-medium text-slate-600">{l.key}</code>
                  <Badge variant={l.isHeld ? "default" : "secondary"} className="text-[9px] font-bold uppercase">
                    {l.isHeld ? "HELD" : "EXPIRED"}
                  </Badge>
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  Diperbarui {new Date(l.updatedAt).toLocaleString("id-ID")}
                </p>
              </Card>
            ))}
            {(data?.locks ?? []).length === 0 && !loading && (
              <p className="text-sm text-slate-400">Tidak ada locks.</p>
            )}
          </div>
        </div>

        {/* Commands */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Gear size={16} className="text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-600">Perintah Channel Terbaru</h3>
          </div>
          <Card>
            {(data?.commands ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Tidak ada perintah.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {(data?.commands ?? []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-[10px] font-bold uppercase">{c.kind}</Badge>
                      <span className="text-sm text-slate-600">{c.provider}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={c.status === "DONE" ? "default" : c.status === "FAILED" ? "destructive" : "secondary"}
                        className="text-[10px] font-bold uppercase">{c.status}</Badge>
                      <span className="text-xs text-slate-300">{new Date(c.createdAt).toLocaleString("id-ID")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Sync freshness */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Database size={16} className="text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-600">Sinkronisasi Sheets</h3>
          </div>
          {(data?.sources ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">Tidak ada sumber Google Sheets aktif.</p>
          ) : (
            <Card>
              <div className="divide-y divide-slate-100">
                {(data?.sources ?? []).map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm font-medium text-slate-700">{s.name}</span>
                    <span className="text-xs text-slate-400">
                      {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString("id-ID") : "Belum pernah"}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
