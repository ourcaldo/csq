import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { StatusDot } from "@/components/status-dot";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  userCount: number;
  channelCount: number;
  conversationCount: number;
  messageCount30d: number;
  mediaBytes: number;
};
type Overview = { items: Tenant[] };
type Ops = {
  locks: { key: string; isHeld: boolean }[];
  outbox: { status: string; count: number }[];
  failedMessages: { id: string; toJid: string; error: string | null }[];
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function Metric({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <p className="kpi-l">{label}</p>
      <p className="kpi mt-2">{value.toLocaleString("id-ID")}</p>
      <p className="mt-1 h-4 text-[11px] text-slate-400">{note ?? ""}</p>
    </div>
  );
}

export default function AdminOverview() {
  const { data: tenantsData } = useAdminApi<Overview>("/api/admin/tenants");
  const { data: opsData } = useAdminApi<Ops>("/api/admin/operations");

  const tenants = tenantsData?.items ?? [];
  const active = tenants.filter((t) => t.status === "ACTIVE").length;
  const suspended = tenants.length - active;
  const totalUsers = tenants.reduce((s, t) => s + t.userCount, 0);
  const totalChannels = tenants.reduce((s, t) => s + t.channelCount, 0);
  const totalMsgs = tenants.reduce((s, t) => s + t.messageCount30d, 0);
  const outboxCount = (status: string) =>
    opsData?.outbox.find((o) => o.status === status)?.count ?? 0;
  const failed = outboxCount("FAILED");
  const leases = opsData?.locks ?? [];
  const heldLeases = leases.filter((l) => l.isHeld).length;

  return (
    <AdminShell title="Ringkasan">
      <div className="space-y-5">
        <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-slate-200 lg:grid-cols-4">
          <Metric label="Tenant aktif" value={active} note={`${suspended} ditangguhkan`} />
          <Metric label="Pengguna" value={totalUsers} note="Seluruh tenant" />
          <Metric label="Saluran" value={totalChannels} note="WhatsApp" />
          <Metric label="Pesan 30 hari" value={totalMsgs} note="Masuk dan keluar" />
        </div>

        {failed > 0 && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 border-l-2 border-l-red-600 bg-white px-4 py-3">
            <p className="text-[13px] text-slate-700">
              <span className="font-semibold text-red-700">{failed} pesan gagal</span> dikirim
              ke pelanggan.
            </p>
            <Link href="/admin/operations" className="link-quiet shrink-0">
              Buka operasional
            </Link>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="panel lg:col-span-2">
            <div className="panel-h">
              <h2 className="panel-t">Tenant</h2>
              <Link href="/admin/tenants" className="link-quiet">
                Semua tenant
              </Link>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Status</th>
                  <th className="text-right">Pengguna</th>
                  <th className="text-right">Saluran</th>
                  <th className="text-right">Pesan 30h</th>
                </tr>
              </thead>
              <tbody>
                {tenants.slice(0, 8).map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link
                        href="/admin/tenants"
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {t.name}
                      </Link>
                      <span className="ml-2 text-[11px] text-slate-400">{t.slug}</span>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <StatusDot tone={t.status === "ACTIVE" ? "ok" : "bad"} />
                        {t.status === "ACTIVE" ? "Aktif" : "Ditangguhkan"}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{t.userCount}</td>
                    <td className="text-right tabular-nums">{t.channelCount}</td>
                    <td className="text-right tabular-nums">{t.messageCount30d}</td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-[13px] text-slate-400">
                      Belum ada tenant.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="panel self-start">
            <div className="panel-h">
              <h2 className="panel-t">Sistem</h2>
              <span className="text-[11px] text-slate-400">Worker</span>
            </div>
            <div className="divide-y divide-slate-100">
              {["QUEUED", "SENDING", "SENT", "FAILED"].map((s) => (
                <div key={s} className="flex items-center justify-between px-4 py-2.5">
                  <span className="flex items-center gap-2 text-[13px] text-slate-600">
                    <StatusDot
                      tone={s === "FAILED" ? "bad" : s === "SENT" ? "ok" : "idle"}
                    />
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </span>
                  <span className="text-[13px] font-medium tabular-nums text-slate-900">
                    {outboxCount(s)}
                  </span>
                </div>
              ))}
            </div>
            <div className="panel-h border-t border-slate-200">
              <h2 className="panel-t">Lease</h2>
              <span className="text-[11px] text-slate-400">
                {heldLeases} dari {leases.length} aktif
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {leases.slice(0, 4).map((l) => (
                <div key={l.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <code className="truncate font-mono text-[11px] text-slate-500">{l.key}</code>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
                    <StatusDot tone={l.isHeld ? "ok" : "idle"} />
                    {l.isHeld ? "Held" : "Expired"}
                  </span>
                </div>
              ))}
              {leases.length === 0 && (
                <p className="px-4 py-6 text-center text-[12px] text-slate-400">
                  Tidak ada lease.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </AdminShell>
  );
}
