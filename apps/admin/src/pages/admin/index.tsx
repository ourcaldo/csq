import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Storefront,
  ChatCircleDots,
  Tray,
  Warning,
  PaperPlaneTilt,
  Robot,
  FolderOpen,
  ArrowUpRight,
  CheckCircle,
} from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Card, Group, PageHead, Stat, Status, btnClass, pad } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  conversationCount: number;
};
type Channel = {
  id: string;
  tenantName: string;
  tenantSlug: string;
  provider: string;
  status: string;
  leaseHeld: boolean;
};
type Ops = { outbox: { status: string; count: number }[] };
type Usage = {
  items: {
    tenantId: string;
    tenantName: string;
    agentReplies: number;
    agentRepliesLimit: number | null;
    outbound: number;
    outboundLimit: number | null;
    inbound: number;
    mediaBytes: number;
  }[];
  daily: { date: string; count: number }[];
};
type AuditItem = { id: string; action: string; tenantName?: string; createdAt: string };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Chart({ daily }: { daily: { date: string; count: number }[] }) {
  const max = Math.max(...daily.map((d) => d.count), 0);
  const top = Math.max(8, Math.ceil(max / 8) * 8);
  const ticks = [top, (top * 3) / 4, top / 2, top / 4, 0];
  const peak = daily.findIndex((d) => d.count === max && max > 0);
  const H = 180;

  return (
    <div className="flex gap-3">
      <div
        className="flex flex-col justify-between pb-7 text-right font-mono text-[10.5px] text-muted-foreground"
        style={{ height: H + 28 }}
      >
        {ticks.map((t) => (
          <span key={t} className="leading-none">
            {t}
          </span>
        ))}
      </div>
      <div className="relative flex-1">
        <div className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: H }}>
          {ticks.map((t) => (
            <div key={t} className="border-t border-dashed border-border" />
          ))}
        </div>
        <div className="relative flex items-end gap-1.5" style={{ height: H }}>
          {daily.map((d, i) => (
            <div key={d.date} className="group relative flex h-full flex-1 items-end">
              <div
                className={`w-full rounded-full transition-colors ${
                  i === peak
                    ? "bg-foreground"
                    : "bg-muted ring-1 ring-border/60 group-hover:bg-foreground/70"
                }`}
                style={{ height: Math.max(10, (d.count / top) * H) }}
              />
              <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[10.5px] text-background group-hover:block">
                {d.count}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5 font-mono text-[10px] text-muted-foreground">
          {daily.map((d, i) => (
            <span key={d.date} className={`flex-1 text-center ${i % 3 === 0 ? "" : "invisible"}`}>
              {new Date(d.date).getUTCDate()}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdminOverview() {
  const { data: session } = useSession();
  const { data: tenantsData } = useAdminApi<{ items: Tenant[] }>("/api/admin/tenants");
  const { data: channelsData } = useAdminApi<{ items: Channel[] }>("/api/admin/channels");
  const { data: opsData } = useAdminApi<Ops>("/api/admin/operations");
  const { data: usageData } = useAdminApi<Usage>("/api/admin/usage");
  const { data: auditData } = useAdminApi<{ items: AuditItem[] }>("/api/admin/audit");

  const tenants = tenantsData?.items ?? [];
  const channels = channelsData?.items ?? [];
  const usage = usageData?.items ?? [];
  const daily = usageData?.daily ?? [];
  const audit = auditData?.items ?? [];

  const suspended = tenants.filter((t) => t.status !== "ACTIVE").length;
  const connected = channels.filter((c) => c.status === "CONNECTED").length;
  const down = channels.filter((c) => c.status !== "CONNECTED");
  const outbox = (status: string) =>
    opsData?.outbox.find((o) => o.status === status)?.count ?? 0;
  const failed = outbox("FAILED");

  const totalMessages = daily.reduce((s, d) => s + d.count, 0);
  const aiReplies = usage.reduce((s, u) => s + u.agentReplies, 0);
  const outbound = usage.reduce((s, u) => s + u.outbound, 0);
  const inbound = usage.reduce((s, u) => s + u.inbound, 0);
  const media = usage.reduce((s, u) => s + u.mediaBytes, 0);
  const conversations = tenants.reduce((s, t) => s + t.conversationCount, 0);

  const quotas = usage
    .map((u) => {
      const checks: { label: string; used: number; limit: number }[] = [];
      if (u.agentRepliesLimit !== null) {
        checks.push({ label: "Balasan AI", used: u.agentReplies, limit: u.agentRepliesLimit });
      }
      if (u.outboundLimit !== null) {
        checks.push({ label: "Pesan keluar", used: u.outbound, limit: u.outboundLimit });
      }
      const worst = checks
        .map((c) => ({ ...c, pct: Math.round((c.used / c.limit) * 100) }))
        .sort((a, b) => b.pct - a.pct)[0];
      return worst && worst.pct >= 80 ? { tenant: u.tenantName, ...worst } : null;
    })
    .filter((q): q is { tenant: string; label: string; used: number; limit: number; pct: number } =>
      q !== null
    );

  return (
    <AdminShell title="Ringkasan">
      <PageHead
        eyebrow="Platform"
        title={session?.user?.name ? `${session.user.name}, ini kondisi CSQ` : "Ini kondisi CSQ"}
        sub="Sekilas hari ini, dan bagaimana 30 hari terakhir berjalan."
        action={
          <Link href="/admin/tenants" className={btnClass()}>
            Tenant baru
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          icon={<Storefront size={14} />}
          label="Tenant aktif"
          value={pad(tenants.length - suspended)}
          note={`${suspended} ditangguhkan`}
        />
        <Stat
          icon={<ChatCircleDots size={14} />}
          label="Saluran"
          value={pad(channels.length)}
          note={`${connected} terhubung, ${channels.length - connected} terputus`}
        />
        <Stat
          icon={<Tray size={14} />}
          label="Antrean"
          value={pad(outbox("QUEUED"))}
          note={`${outbox("SENDING")} sedang dikirim`}
        />
        <Stat
          icon={<Warning size={14} />}
          label="Gagal kirim"
          value={pad(failed)}
          note={failed > 0 ? "Perlu retry di Operasional" : "Outbox worker sehat"}
        />
      </div>

      <Group label="30 hari terakhir">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            icon={<PaperPlaneTilt size={14} />}
            label="Pesan"
            value={totalMessages}
            note={
              <>
                <span className="text-foreground">{conversations}</span> percakapan dilayani
              </>
            }
          />
          <Stat
            icon={<Robot size={14} />}
            label="Balasan AI"
            value={pad(aiReplies)}
            note={
              <>
                <span className="text-foreground">{outbound}</span> pesan keluar,{" "}
                <span className="text-foreground">{inbound}</span> masuk
              </>
            }
          />
          <Stat
            icon={<FolderOpen size={14} />}
            label="Media"
            value={bytes(media)}
            note="Total penyimpanan media tenant"
          />
        </div>
      </Group>

      <Card className="mb-4 p-5">
        <div className="mb-5 flex items-center justify-between">
          <span className="eyebrow text-foreground">Pesan per hari</span>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {totalMessages} pesan dalam periode
          </span>
        </div>
        <Chart daily={daily} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <span className="eyebrow text-foreground">Perlu perhatian</span>
            <Link
              href="/admin/channels"
              className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              Semua saluran <ArrowUpRight size={13} />
            </Link>
          </div>
          {down.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <CheckCircle size={20} className="mb-2 text-ok" />
              <p className="text-[13px] font-medium">Semua saluran terhubung</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Tidak ada yang butuh tindakan.
              </p>
            </div>
          ) : (
            down.slice(0, 5).map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted ring-1 ring-border">
                  <ChatCircleDots size={14} className="text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{c.tenantName}</div>
                  <div className="font-mono text-[11.5px] text-muted-foreground">
                    {c.provider}
                  </div>
                </div>
                <Status tone={c.status === "CONNECTING" ? "warn" : "bad"}>{c.status}</Status>
              </div>
            ))
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <span className="eyebrow text-foreground">Kuota</span>
            <Link
              href="/admin/plans"
              className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              Paket <ArrowUpRight size={13} />
            </Link>
          </div>
          {quotas.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <CheckCircle size={20} className="mb-2 text-ok" />
              <p className="text-[13px] font-medium">Semua tenant dalam kuota</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Tidak ada pemakaian di atas 80 persen.
              </p>
            </div>
          ) : (
            quotas.slice(0, 5).map((q) => (
              <div
                key={q.tenant + q.label}
                className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{q.tenant}</div>
                  <div className="text-[11.5px] text-muted-foreground">{q.label}</div>
                </div>
                <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
                  {q.used}/{q.limit}
                </span>
                <Status tone={q.pct >= 100 ? "bad" : "warn"}>{q.pct}%</Status>
              </div>
            ))
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <span className="eyebrow text-foreground">Aktivitas terbaru</span>
            <Link
              href="/admin/audit"
              className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
            >
              Log audit <ArrowUpRight size={13} />
            </Link>
          </div>
          {audit.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <p className="text-[13px] font-medium">Belum ada aktivitas</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Aksi tenant dan admin akan muncul di sini.
              </p>
            </div>
          ) : (
            audit.slice(0, 6).map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    e.action.includes("error") ? "bg-bad" : "bg-muted-foreground/50"
                  }`}
                />
                <span className="flex-1 truncate font-mono text-[12px]">
                  {e.action}
                </span>
                <span className="font-mono text-[11.5px] text-muted-foreground">
                  {new Date(e.createdAt).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      {failed > 0 && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3">
          <p className="text-[13px]">
            <span className="font-medium text-bad">{failed} pesan gagal</span> dikirim ke
            pelanggan.
          </p>
          <Link href="/admin/operations" className={btnClass("line")}>
            Retry
          </Link>
        </div>
      )}
    </AdminShell>
  );
}
