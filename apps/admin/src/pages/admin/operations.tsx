import { useState } from "react";
import { Tray, PaperPlaneTilt, CheckCircle, Warning, Lock, Pulse, Timer } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Card, Empty, PageHead, Section, Stat, Status, TableCard, pad } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Operations (PRD 13 Phase 3; refocused 2026-11-13, owner request): system
// health first - service reachability and latency as a tile grid, the worker
// runtime heartbeat, database latency, and the AI reply-time SLA - with the
// operational queues (outbox, failed messages, locks) below. Sections render
// only when the API returned data: a failed load shows the error banner, not
// fabricated "down" statuses. Console copy is English (owner direction
// 2026-11-13).

type ServicePing = {
  name: string;
  ok: boolean;
  ms: number;
  status: number | null;
};
type ReplyStats = {
  count: number;
  avgSeconds: number | null;
  p95Seconds: number | null;
};
type Ops = {
  health: {
    services: ServicePing[];
    db: { ok: boolean; ms: number };
  };
  aiResponse: { hours24: ReplyStats; days7: ReplyStats };
  locks: { key: string; lockedUntil: string; isHeld: boolean; updatedAt: string }[];
  outbox: { status: string; count: number }[];
  failedMessages: {
    id: string;
    tenantId: string;
    toJid: string;
    error: string | null;
    updatedAt: string;
  }[];
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSeconds(v: number | null): string {
  if (v === null) return "-";
  return `${v.toFixed(1)}s`;
}

function HealthTile({
  name,
  tone,
  status,
  value,
  note,
}: {
  name: string;
  tone: "ok" | "bad";
  status: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]">{name}</span>
        <Status tone={tone}>{status}</Status>
      </div>
      <div className="mt-4 font-mono text-[26px] font-medium leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-2.5 text-[12px] text-muted-foreground">{note}</div>
    </Card>
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

  const failed = data?.failedMessages ?? [];
  const locks = data?.locks ?? [];
  const held = locks.filter((l) => l.isHeld).length;
  const heartbeat = locks.find((l) => l.key === "worker-heartbeat");

  return (
    <AdminShell title="Operations">
      <PageHead eyebrow="Operations" title="Operations" sub="System health, AI response time, queues & locks" />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}
      {!error && !data && (
        <p className="text-[12.5px] text-muted-foreground">Loading operations data...</p>
      )}

      {data && (
        <>
          <Section title="System health" meta="current status">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
              {data.health.services.map((s) => (
                <HealthTile
                  key={s.name}
                  name={s.name}
                  tone={s.ok ? "ok" : "bad"}
                  status={s.ok ? "Healthy" : "No response"}
                  value={`${s.ms} ms`}
                  note={s.ok ? `HTTP ${s.status}` : "no answer within 5s"}
                />
              ))}
              <HealthTile
                name="Worker runtime"
                tone={heartbeat?.isHeld ? "ok" : "bad"}
                status={heartbeat?.isHeld ? "Active" : "Stopped"}
                value={heartbeat ? ago(heartbeat.updatedAt) : "-"}
                note="heartbeat lock"
              />
              <HealthTile
                name="Database"
                tone={data.health.db.ok ? "ok" : "bad"}
                status={data.health.db.ok ? "Healthy" : "Failed"}
                value={`${data.health.db.ms} ms`}
                note="SELECT 1"
              />
            </div>
          </Section>

          <Section title="AI response time" meta="last inbound message to agent reply">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat icon={<Timer size={14} />} label="Avg (24h)" value={fmtSeconds(data.aiResponse.hours24.avgSeconds)} />
              <Stat icon={<Timer size={14} />} label="p95 (24h)" value={fmtSeconds(data.aiResponse.hours24.p95Seconds)} />
              <Stat icon={<Pulse size={14} />} label="Replies (24h)" value={pad(data.aiResponse.hours24.count)} />
              <Stat icon={<Timer size={14} />} label="Avg (7d)" value={fmtSeconds(data.aiResponse.days7.avgSeconds)} />
            </div>
          </Section>

          <Section title="Outbound messages" meta="worker outbox">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat icon={<Tray size={14} />} label="Queued" value={pad(data.outbox.find((o) => o.status === "QUEUED")?.count ?? 0)} />
              <Stat icon={<PaperPlaneTilt size={14} />} label="Sending" value={pad(data.outbox.find((o) => o.status === "SENDING")?.count ?? 0)} />
              <Stat icon={<CheckCircle size={14} />} label="Sent" value={pad(data.outbox.find((o) => o.status === "SENT")?.count ?? 0)} />
              <Stat icon={<Warning size={14} />} label="Failed" value={pad(data.outbox.find((o) => o.status === "FAILED")?.count ?? 0)} />
            </div>
          </Section>

          <Section title="Failed messages" meta={`${failed.length} messages`}>
            {failed.length === 0 ? (
              <Empty
                title="No failed messages"
                hint="The outbox worker has nothing to retry."
                icon={<CheckCircle size={16} className="text-ok" />}
              />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Destination</th>
                      <th>Error</th>
                      <th>Updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {failed.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap font-mono text-[12px]">{m.toJid}</td>
                        <td className="max-w-md truncate text-[12.5px] text-bad">{m.error ?? "-"}</td>
                        <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                          {when(m.updatedAt)}
                        </td>
                        <td className="text-right">
                          <Btn
                            variant="ghost"
                            disabled={busy === m.id}
                            onClick={() => void retry(m.id)}
                            className="hover:text-primary"
                          >
                            Retry
                          </Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="System locks" meta={`${held} held`}>
            {locks.length === 0 ? (
              <Empty
                title="No locks"
                hint="The worker runs without contention."
                icon={<Lock size={16} className="text-muted-foreground" />}
              />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Status</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locks.map((l) => (
                      <tr key={l.key}>
                        <td className="font-mono text-[12px]">{l.key}</td>
                        <td>
                          <Status tone={l.isHeld ? "ok" : "off"}>
                            {l.isHeld ? "Held" : "Expired"}
                          </Status>
                        </td>
                        <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                          {when(l.updatedAt)} ({ago(l.updatedAt)})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>
        </>
      )}
    </AdminShell>
  );
}
