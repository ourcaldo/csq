import { useState } from "react";
import { Tray, PaperPlaneTilt, CheckCircle, Warning, Lock, Pulse, Timer } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, Section, Stat, Status, TableCard, pad } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Operasional (PRD 13 Phase 3; refocused 2026-11-13, owner request): system
// health first - service reachability and latency, the worker runtime
// heartbeat, database latency, and the AI reply-time SLA - with the
// operational queues (outbox, failed messages, locks) below. Sections render
// only when the API returned data: a failed load shows the error banner, not
// fabricated "down" statuses.

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
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSeconds(v: number | null): string {
  if (v === null) return "-";
  return `${v.toFixed(1).replace(".", ",")} detik`;
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

  return (
    <AdminShell title="Operasional">
      <PageHead eyebrow="Operasi" title="Operasional" sub="Kesehatan sistem, waktu respons AI, antrian & lock" />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}
      {!error && !data && (
        <p className="text-[12.5px] text-muted-foreground">Memuat data operasional...</p>
      )}

      {data && (
        <>
          <Section title="Kesehatan sistem" meta="status saat ini">
            <TableCard>
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Layanan</th>
                    <th>Status</th>
                    <th>Latensi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.health.services.map((s) => (
                    <tr key={s.name}>
                      <td className="text-[13px] font-medium">{s.name}</td>
                      <td>
                        <Status tone={s.ok ? "ok" : "bad"}>
                          {s.ok ? "Sehat" : "Tidak merespons"}
                        </Status>
                      </td>
                      <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                        {s.ok ? `${s.ms} ms (HTTP ${s.status})` : `${s.ms} ms (tidak ada jawaban)`}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="text-[13px] font-medium">Worker runtime</td>
                    <td>
                      <Status tone={locks.some((l) => l.key === "worker-heartbeat" && l.isHeld) ? "ok" : "bad"}>
                        {locks.some((l) => l.key === "worker-heartbeat" && l.isHeld) ? "Aktif" : "Tidak aktif"}
                      </Status>
                    </td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                      {(() => {
                        const hb = locks.find((l) => l.key === "worker-heartbeat");
                        return hb ? `heartbeat ${ago(hb.updatedAt)}` : "-";
                      })()}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-[13px] font-medium">Database</td>
                    <td>
                      <Status tone={data.health.db.ok ? "ok" : "bad"}>
                        {data.health.db.ok ? "Sehat" : "Gagal"}
                      </Status>
                    </td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                      {data.health.db.ms} ms (SELECT 1)
                    </td>
                  </tr>
                </tbody>
              </table>
            </TableCard>
          </Section>

          <Section title="Waktu respons AI" meta="dari pesan masuk ke balasan agen">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat icon={<Timer size={14} />} label="Rata-rata 24 jam" value={fmtSeconds(data.aiResponse.hours24.avgSeconds)} />
              <Stat icon={<Timer size={14} />} label="p95 24 jam" value={fmtSeconds(data.aiResponse.hours24.p95Seconds)} />
              <Stat icon={<Pulse size={14} />} label="Balasan 24 jam" value={pad(data.aiResponse.hours24.count)} />
              <Stat icon={<Timer size={14} />} label="Rata-rata 7 hari" value={fmtSeconds(data.aiResponse.days7.avgSeconds)} />
            </div>
          </Section>

          <Section title="Pesan keluar" meta="outbox worker">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat icon={<Tray size={14} />} label="Queued" value={pad(data.outbox.find((o) => o.status === "QUEUED")?.count ?? 0)} />
              <Stat icon={<PaperPlaneTilt size={14} />} label="Sending" value={pad(data.outbox.find((o) => o.status === "SENDING")?.count ?? 0)} />
              <Stat icon={<CheckCircle size={14} />} label="Sent" value={pad(data.outbox.find((o) => o.status === "SENT")?.count ?? 0)} />
              <Stat icon={<Warning size={14} />} label="Failed" value={pad(data.outbox.find((o) => o.status === "FAILED")?.count ?? 0)} />
            </div>
          </Section>

          <Section title="Pesan gagal" meta={`${failed.length} pesan`}>
            {failed.length === 0 ? (
              <Empty
                title="Tidak ada pesan gagal"
                hint="Tidak ada kiriman outbox yang perlu di-retry."
                icon={<CheckCircle size={16} className="text-ok" />}
              />
            ) : (
              <TableCard>
                <table className="ledger">
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

          <Section title="System locks" meta={`${held} dipegang`}>
            {locks.length === 0 ? (
              <Empty
                title="Tidak ada lock"
                hint="Worker berjalan tanpa kontensi."
                icon={<Lock size={16} className="text-muted-foreground" />}
              />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Status</th>
                      <th>Diperbarui</th>
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
