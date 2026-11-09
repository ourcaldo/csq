import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Empty, PageHead, Section, Stat, Status, TableCard, btnClass } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

// ADM-1 (PRD 16): read-only tenant drill-down over the existing detail GET.

type Detail = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  userCount: number;
  channelCount: number;
  conversationCount: number;
  messageCount30d: number;
  mediaBytes: number;
  users: { id: string; email: string; name: string | null; role: string }[];
  channels: { id: string; provider: string; status: string; type: string }[];
  agents: { id: string; name: string; status: string }[];
  campaigns: { id: string; name: string; status: string; scheduleKind: string }[];
  dataSources: {
    id: string;
    name: string;
    type: string;
    status: string;
    lastSyncAt: string | null;
  }[];
};

export const getServerSideProps = withAdminAuth<{ id: string }>(async (ctx) => ({
  props: { id: String(ctx.params?.id ?? "") },
}));

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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

function agentTone(status: string): "ok" | "warn" | "off" {
  if (status === "ACTIVE") return "ok";
  if (status === "PAUSED") return "warn";
  return "off";
}

function campaignTone(status: string): "ok" | "warn" | "off" {
  if (status === "ACTIVE" || status === "COMPLETED") return "ok";
  if (status === "PAUSED") return "warn";
  return "off";
}

function sourceTone(status: string): "ok" | "bad" | "off" {
  if (status === "ACTIVE") return "ok";
  if (status === "ERROR") return "bad";
  return "off";
}

export default function TenantDetailPage({ id }: { id: string }) {
  const { data, loading, error } = useAdminApi<Detail>(`/api/admin/tenants/${id}`);

  return (
    <AdminShell title="Detail tenant">
      <PageHead
        eyebrow="Platform"
        title={data?.name ?? "Tenant"}
        sub={data ? `${data.slug}, hanya baca` : "Detail tenant, hanya baca"}
        action={
          <Link href="/admin/tenants" className={btnClass("ghost")}>
            <ArrowLeft size={14} />
            Semua tenant
          </Link>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}
      {loading && (
        <p className="text-[13px] text-muted-foreground">Memuat detail tenant...</p>
      )}

      {data && (
        <div className="space-y-8">
          <Section
            title="Ringkasan"
            meta={
              <Status tone={data.status === "ACTIVE" ? "ok" : "bad"}>
                {data.status === "ACTIVE" ? "Aktif" : "Ditangguhkan"}
              </Status>
            }
          >
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
              <Stat
                label="Dibuat"
                value={new Date(data.createdAt).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              />
              <Stat label="Pengguna" value={data.userCount} />
              <Stat label="Saluran" value={data.channelCount} />
              <Stat label="Percakapan" value={data.conversationCount} />
              <Stat label="Pesan 30 hari" value={data.messageCount30d} />
              <Stat label="Media" value={bytes(data.mediaBytes)} />
            </div>
          </Section>

          <Section title="Pengguna" meta={`${data.users.length} akun`}>
            {data.users.length === 0 ? (
              <Empty title="Belum ada pengguna" hint="Tenant belum memiliki akun." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Email</th>
                      <th>Peran</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id}>
                        <td className="font-medium">{u.name ?? "-"}</td>
                        <td className="font-mono text-[12.5px] text-muted-foreground">
                          {u.email}
                        </td>
                        <td>
                          <Status tone={u.role === "OWNER" ? "ok" : "off"}>
                            {u.role === "OWNER" ? "Owner" : "Staf"}
                          </Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Agent" meta={`${data.agents.length} agent`}>
            {data.agents.length === 0 ? (
              <Empty title="Belum ada agent" hint="Agent tenant akan muncul di sini." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agents.map((a) => (
                      <tr key={a.id}>
                        <td className="font-medium">{a.name}</td>
                        <td>
                          <Status tone={agentTone(a.status)}>{a.status}</Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Saluran" meta={`${data.channels.length} saluran`}>
            {data.channels.length === 0 ? (
              <Empty title="Belum ada saluran" hint="Saluran tenant akan muncul di sini." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Tipe</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.channels.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.provider}</td>
                        <td className="text-[13px] text-muted-foreground">{c.type}</td>
                        <td>
                          <Status tone={c.status === "CONNECTED" ? "ok" : "bad"}>
                            {c.status === "CONNECTED" ? "Terhubung" : "Terputus"}
                          </Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Kampanye" meta={`${data.campaigns.length} kampanye`}>
            {data.campaigns.length === 0 ? (
              <Empty title="Belum ada kampanye" hint="Kampanye tenant akan muncul di sini." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Status</th>
                      <th>Jadwal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.name}</td>
                        <td>
                          <Status tone={campaignTone(c.status)}>{c.status}</Status>
                        </td>
                        <td className="font-mono text-[12px] text-muted-foreground">
                          {c.scheduleKind}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Sumber Data" meta={`${data.dataSources.length} sumber`}>
            {data.dataSources.length === 0 ? (
              <Empty title="Belum ada sumber data" hint="Sumber data tenant akan muncul di sini." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Tipe</th>
                      <th>Status</th>
                      <th>Sinkron terakhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dataSources.map((d) => (
                      <tr key={d.id}>
                        <td className="font-medium">{d.name}</td>
                        <td className="font-mono text-[12px] text-muted-foreground">{d.type}</td>
                        <td>
                          <Status tone={sourceTone(d.status)}>{d.status}</Status>
                        </td>
                        <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                          {when(d.lastSyncAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>
        </div>
      )}
    </AdminShell>
  );
}
