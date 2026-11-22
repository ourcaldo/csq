import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel, pad } from "@/components/console";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Operations & telemetry (template viewOperations 1:1): infrastructure probe
// strip, AI latency row, failed outbox with per-row and bulk retry, locks.

type ServicePing = { name: string; ok: boolean; ms: number; status: number | null };
type ReplyStats = { count: number; avgSeconds: number | null; p95Seconds: number | null };
type Ops = {
  health: { services: ServicePing[]; db: { ok: boolean; ms: number } };
  aiResponse: { hours24: ReplyStats; days7: ReplyStats };
  locks: { key: string; lockedUntil: string; isHeld: boolean; updatedAt: string }[];
  outbox: { status: string; count: number }[];
  failedMessages: { id: string; toJid: string; error: string | null; updatedAt: string }[];
};

const PROBE_SUB: Record<string, string> = {
  Dashboard: "HTTP",
  API: "HTTP",
  Worker: "Heartbeat",
  Database: "SELECT 1",
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function OperationsPage() {
  const { data, loading, error, refresh } = useAdminApi<Ops>("/api/admin/operations");
  const [busy, setBusy] = useState<string | null>(null);

  const failed = data?.failedMessages ?? [];
  const locks = data?.locks ?? [];
  const heldLocks = locks.filter((l) => l.isHeld).length;
  const outboxCount = (status: string) => data?.outbox.find((o) => o.status === status)?.count ?? 0;

  async function retry(messageId: string) {
    setBusy(messageId);
    try {
      await adminFetch("/api/admin/operations", "POST", { messageId });
      showToast("Message requeued to worker outbox");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function retryAll() {
    setBusy("all");
    try {
      await Promise.all(failed.map((m) => adminFetch("/api/admin/operations", "POST", { messageId: m.id })));
      showToast("All failed messages requeued");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Operations">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Operations &amp; Telemetry</h1>
        <p className="mt-1 text-xs text-slate-500">
          Infrastructure latency probes, AI inference response percentiles, outbound worker retries, and distributed
          scheduler locks.
        </p>
      </div>

      {error && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {error}
        </div>
      )}
      {!error && !data && (
        <p className="mt-6 text-xs text-slate-400">{loading ? "Loading operations data..." : "No data."}</p>
      )}

      {data && (
        <>
          {/* Infrastructure probes strip */}
          <div className="mt-6 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-5 sm:divide-x sm:divide-slate-200">
            {data.health.services.map((s, idx) => (
              <div key={s.name} className={`py-3.5 ${idx > 0 ? "sm:px-4" : "pr-4"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-400">{s.name}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${s.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                </div>
                <p className="mt-1 font-mono text-base font-semibold text-slate-900">
                  {s.ok ? `${s.ms} ms` : "No answer"}
                </p>
                <p className={`mt-0.5 font-mono text-[10px] ${s.ok ? "text-emerald-700" : "text-red-600"}`}>
                  {s.ok ? `${PROBE_SUB[s.name] ?? "HTTP"} ${s.status ?? ""}` : "no answer within 5s"}
                </p>
              </div>
            ))}
            <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-400">PostgreSQL</span>
                <span className={`h-1.5 w-1.5 rounded-full ${data.health.db.ok ? "bg-emerald-500" : "bg-red-500"}`} />
              </div>
              <p className="mt-1 font-mono text-base font-semibold text-slate-900">
                {data.health.db.ok ? `${data.health.db.ms} ms` : "Failed"}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-emerald-700">SELECT 1</p>
            </div>
          </div>

          {/* AI latency & outbox row */}
          <div className="grid grid-cols-2 border-b border-slate-200 py-4 sm:grid-cols-4 sm:divide-x sm:divide-slate-200">
            <div className="pr-4">
              <p className="text-[11px] text-slate-400">AI Avg Latency (24h)</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">
                {data.aiResponse.hours24.avgSeconds !== null ? `${data.aiResponse.hours24.avgSeconds.toFixed(1)}s` : "-"}{" "}
                <span className="text-xs font-normal text-slate-400">
                  (p95: {data.aiResponse.hours24.p95Seconds !== null ? `${data.aiResponse.hours24.p95Seconds.toFixed(1)}s` : "-"})
                </span>
              </p>
            </div>
            <div className="sm:px-5">
              <p className="text-[11px] text-slate-400">AI Replies (24h)</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{pad(data.aiResponse.hours24.count)}</p>
            </div>
            <div className="mt-3 sm:mt-0 sm:px-5">
              <p className="text-[11px] text-slate-400">Outbox Delivered</p>
              <p className="mt-1 font-mono text-lg font-semibold text-emerald-700">
                {outboxCount("SENT").toLocaleString("en-GB")}
              </p>
            </div>
            <div className="mt-3 sm:mt-0 sm:pl-5">
              <p className="text-[11px] text-slate-400">Outbox Failed</p>
              <p className={`mt-1 font-mono text-lg font-semibold ${failed.length > 0 ? "text-red-600" : "text-slate-900"}`}>
                {pad(failed.length)}
              </p>
            </div>
          </div>

          {/* Failed outbound messages */}
          <div className="border-b border-slate-200 py-6">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Failed Outbox Messages ({failed.length})
              </h2>
              {failed.length > 0 && (
                <button
                  type="button"
                  disabled={busy === "all"}
                  onClick={() => void retryAll()}
                  className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-40"
                >
                  Retry All ({failed.length})
                </button>
              )}
            </div>

            {failed.length === 0 ? (
              <div className="border-y border-slate-200 py-8 text-center text-xs text-slate-500">
                Outbox queue is healthy - zero failed messages pending retry.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="py-2.5 pr-4">Destination JID</th>
                      <th className="px-4 py-2.5">Error Reason</th>
                      <th className="px-4 py-2.5">Timestamp</th>
                      <th className="py-2.5 pl-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                    {failed.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/80">
                        <td className="py-3 pr-4 font-mono text-slate-800">{m.toJid}</td>
                        <td className="px-4 py-3 text-red-600">{m.error ?? "-"}</td>
                        <td className="px-4 py-3 font-mono text-slate-400">
                          {new Date(m.updatedAt).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-3 pl-4 text-right">
                          <button
                            type="button"
                            disabled={busy === m.id}
                            onClick={() => void retry(m.id)}
                            className="rounded border border-slate-200 bg-card px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                          >
                            Requeue
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Distributed scheduler locks */}
          <div className="pt-6">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Distributed Scheduler Locks ({heldLocks} held)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 pr-4">Lock Key</th>
                    <th className="px-4 py-2.5">Lease Status</th>
                    <th className="py-2.5 pl-4 text-right">Last Heartbeat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                  {locks.map((l) => (
                    <tr key={l.key} className="hover:bg-slate-50/80">
                      <td className="py-3 pr-4 font-mono text-slate-800">{l.key}</td>
                      <td className="px-4 py-3">
                        <StatusLabel tone={l.isHeld ? "ok" : "off"}>{l.isHeld ? "Held" : "Expired"}</StatusLabel>
                      </td>
                      <td className="py-3 pl-4 text-right font-mono text-slate-500">
                        {new Date(l.updatedAt).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
