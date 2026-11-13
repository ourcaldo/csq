import { useState } from "react";
import { Tray, PaperPlaneTilt, CheckCircle, Warning, Lock, Pulse, Timer } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, Section, Stat, Status, TableCard, pad } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Operasional (PRD 13 Phase 3; refocused 2026-11-13, owner request): system
// health first - service reachability and latency, the worker runtime
// heartbeat, database latency, and the AI reply-time SLA - with the
// operational queues (outbox, failed messages, locks) below.

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
  if (mins < 60) return `${mins} mnt lalu`;
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
  return `${v.toFixed(1).replace(".", ",")} dtk`;
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
  const locks = data?.locks ?? [];
  const services = data?.health.services ?? [];
  const heartbeat = locks.find((l) => l.key === "worker-heartbeat");
  const ai = data?.aiResponse;
  const held = locks.filter((l) => l.isHeld).length;

  return (
    <AdminShell title="Operasional">
      <PageHead eyebrow="Operasi" title="Operasional" sub="Kesehatan sistem, waktu respons AI, antrian & lock" />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}

      <Section title="Kesehatan sistem" meta="dicek saat halaman dibuka">
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
              {services.map((s) => (
                <tr key={s.name}>
                  <td className="text-[13px] font-medium">{s.name}</td>
                  <td>
                    <Status tone={s.ok ? "ok" : "bad"}>
                      {s.ok ? "Sehat" : "Tidak merespons"}
                    </Status>
                  </td>
                  <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                    {s.ok ? `${s.ms} ms (HTTP ${s.status})` : `${s.ms} ms (timeout)`}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="text-[13px] font-medium">Runtime worker</td>
                <td>
                  <Status tone={heartbeat?.isHeld ? "ok" : "bad"}>
                    {heartbeat?.isHeld ? "Hidup" : "Tidak jalan"}
                  </Status>
                </td>
                <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                  {heartbeat ? `jantung ${ago(heartbeat.updatedAt)}` : "belum ada jantung"}
                </td>
              </tr>
              <tr>
                <td className="text-[13px] font-medium">Database</td>
                <td>
                  <Status tone={data?.health.db.ok ? "ok" : "bad"}>
                    {data?.health.db.ok ? "Sehat" : "Gagal"}
                  </Status>
                </td>
                <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                  {data ? `${data.health.db.ms} ms (SELECT 1)` : "-"}
                </td>
              </tr>
            </tbody>
          </table>
        </TableCard>
      </Section>

      <Section title="Waktu respons AI" meta="dari pesan masuk ke balasan agen">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon={<Timer size={14} />} label="Rata-rata 24 jam" value={fmtSeconds(ai?.hours24.avgSeconds ?? null)} />
          <Stat icon={<Timer size={14} />} label="p95 24 jam" value={fmtSeconds(ai?.hours24.p95Seconds ?? null)} />
          <Stat icon={<Pulse size={14} />} label="Balasan 24 jam" value={pad(ai?.hours24.count ?? 0)} />
          <Stat icon={<Timer size={14} />} label="Rata-rata 7 hari" value={fmtSeconds(ai?.days7.avgSeconds ?? null)} />
        </div>
      </Section>

      <Section title="Pesan keluar" meta="outbox worker">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon={<Tray size={14} />} label="Queued" value={pad(count("QUEUED"))} />
          <Stat icon={<PaperPlaneTilt size={14} />} label="Sending" value={pad(count("SENDING"))} />
          <Stat icon={<CheckCircle size={14} />} label="Sent" value={pad(count("SENT"))} />
          <Stat icon={<Warning size={14} />} label="Failed" value={pad(count("FAILED"))} />
        </div>
      </Section>

      <Section title="Pesan gagal" meta={`${failed.length} pesan`}>
        {failed.length === 0 ? (
          <Empty
            title="Tidak ada pesan gagal"
            hint="Outbox worker tidak punya kiriman yang perlu di-retry."
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

      {loading && <p className="text-[12.5px] text-muted-foreground">Memuat data operasional...</p>}
    </AdminShell>
  );
}
