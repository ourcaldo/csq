import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusDot } from "@/components/status-dot";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

type Ops = {
  locks: { key: string; lockedUntil: string; isHeld: boolean; updatedAt: string }[];
  outbox: { status: string; count: number }[];
  failedMessages: {
    id: string;
    tenantId: string;
    toJid: string;
    error: string | null;
    updatedAt: string;
  }[];
  commands: {
    id: string;
    kind: string;
    status: string;
    channelId: string;
    provider: string;
    createdAt: string;
  }[];
  sources: { id: string; name: string; lastSyncAt: string | null; tenantId: string }[];
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  const count = (status: string) =>
    data?.outbox.find((o) => o.status === status)?.count ?? 0;
  const failed = data?.failedMessages ?? [];

  return (
    <AdminShell title="Operasional">
      <div className="space-y-5">
        {error && (
          <div className="rounded-lg border border-slate-200 border-l-2 border-l-red-600 bg-white px-4 py-2.5 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <section className="panel grid grid-cols-2 gap-px overflow-hidden bg-slate-200 lg:grid-cols-4">
          {["QUEUED", "SENDING", "SENT", "FAILED"].map((s) => (
            <div key={s} className="bg-white px-4 py-3.5">
              <p className="kpi-l flex items-center gap-1.5">
                <StatusDot
                  tone={s === "FAILED" ? "bad" : s === "SENT" ? "ok" : "idle"}
                />
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </p>
              <p className="kpi mt-2">{count(s)}</p>
            </div>
          ))}
        </section>

        {failed.length > 0 && (
          <section className="panel">
            <div className="panel-h">
              <h2 className="panel-t">Pesan gagal</h2>
              <span className="text-[11px] text-slate-400">{failed.length} pesan</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tujuan</th>
                  <th>Error</th>
                  <th>Diperbarui</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {failed.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap font-mono text-[11px]">{m.toJid}</td>
                    <td className="max-w-md truncate text-[12px] text-red-600">
                      {m.error ?? "-"}
                    </td>
                    <td className="whitespace-nowrap text-[12px] text-slate-500">
                      {when(m.updatedAt)}
                    </td>
                    <td className="text-right">
                      <button
                        disabled={busy === m.id}
                        onClick={() => void retry(m.id)}
                        className="text-[12px] font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="panel">
          <div className="panel-h">
            <h2 className="panel-t">System lock</h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Key</th>
                <th>Status</th>
                <th>Diperbarui</th>
              </tr>
            </thead>
            <tbody>
              {(data?.locks ?? []).map((l) => (
                <tr key={l.key}>
                  <td className="font-mono text-[11px]">{l.key}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <StatusDot tone={l.isHeld ? "ok" : "idle"} />
                      {l.isHeld ? "Held" : "Expired"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-slate-500">
                    {when(l.updatedAt)}
                  </td>
                </tr>
              ))}
              {!loading && (data?.locks ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-[13px] text-slate-400">
                    Tidak ada lock.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-h">
            <h2 className="panel-t">Perintah channel</h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Jenis</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {(data?.commands ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="font-medium text-slate-900">{c.kind}</td>
                  <td>{c.provider}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <StatusDot
                        tone={
                          c.status === "DONE"
                            ? "ok"
                            : c.status === "FAILED"
                              ? "bad"
                              : "warn"
                        }
                      />
                      {c.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-slate-500">
                    {when(c.createdAt)}
                  </td>
                </tr>
              ))}
              {!loading && (data?.commands ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[13px] text-slate-400">
                    Tidak ada perintah.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-h">
            <h2 className="panel-t">Sinkronisasi Sheets</h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Sumber</th>
                <th>Terakhir sinkron</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sources ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="font-medium text-slate-900">{s.name}</td>
                  <td className="text-[12px] text-slate-500">{when(s.lastSyncAt)}</td>
                </tr>
              ))}
              {!loading && (data?.sources ?? []).length === 0 && (
                <tr>
                  <td colSpan={2} className="py-8 text-center text-[13px] text-slate-400">
                    Tidak ada sumber Google Sheets aktif.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </AdminShell>
  );
}
