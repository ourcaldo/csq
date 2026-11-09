import { useState } from "react";
import { Tray, PaperPlaneTilt, CheckCircle, Warning, Lock, Plugs, Database } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, Section, Stat, Status, TableCard, pad } from "@/components/console";
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
  sources: {
    id: string;
    name: string;
    status: string;
    lastSyncAt: string | null;
    tenantId: string;
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
  const commands = data?.commands ?? [];
  const sources = data?.sources ?? [];
  const held = locks.filter((l) => l.isHeld).length;

  return (
    <AdminShell title="Operasional">
      <PageHead eyebrow="Operasi" title="Operasional" sub="Queue, locks & sinkronisasi" />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}

      <div className="mb-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<Tray size={14} />} label="Queued" value={pad(count("QUEUED"))} />
        <Stat icon={<PaperPlaneTilt size={14} />} label="Sending" value={pad(count("SENDING"))} />
        <Stat icon={<CheckCircle size={14} />} label="Sent" value={pad(count("SENT"))} />
        <Stat icon={<Warning size={14} />} label="Failed" value={pad(count("FAILED"))} />
      </div>

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

      <Section title="Perintah saluran terbaru" meta={`${commands.length} terakhir`}>
        {commands.length === 0 ? (
          <Empty
            title="Tidak ada perintah"
            hint="Perintah connect / disconnect akan muncul di sini."
            icon={<Plugs size={16} className="text-muted-foreground" />}
          />
        ) : (
          <TableCard>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Jenis</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Dibuat</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-[12px] font-medium">{c.kind}</td>
                    <td className="text-[13px] text-muted-foreground">{c.provider}</td>
                    <td>
                      <Status
                        tone={
                          c.status === "DONE" ? "ok" : c.status === "FAILED" ? "bad" : "warn"
                        }
                      >
                        {c.status}
                      </Status>
                    </td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                      {when(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <Section title="Sinkronisasi Sheets">
        {sources.length === 0 ? (
          <Empty
            title="Tidak ada sumber Google Sheets aktif"
            hint="Sumber yang tersinkron akan muncul di sini."
            icon={<Database size={16} className="text-muted-foreground" />}
          />
        ) : (
          <TableCard>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Sumber</th>
                  <th>Status</th>
                  <th>Terakhir sinkron</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.name}</td>
                    <td>
                      <Status tone={s.status === "ERROR" ? "bad" : "ok"}>
                        {s.status === "ERROR" ? "Gagal" : "Aktif"}
                      </Status>
                    </td>
                    <td className="font-mono text-[12px] text-muted-foreground">
                      {when(s.lastSyncAt)}
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
