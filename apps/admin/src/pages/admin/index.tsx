import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Storefront, ChatCircleDots, UsersThree, PaperPlaneRight, XCircle, Clock } from "@phosphor-icons/react";
import Link from "next/link";

type Tenant = {
  id: string; name: string; slug: string; status: string;
  userCount: number; channelCount: number; conversationCount: number;
  messageCount30d: number; mediaBytes: number;
};
type Overview = { items: Tenant[] };
type Ops = {
  locks: { key: string; isHeld: boolean }[];
  outbox: { status: string; count: number }[];
  failedMessages: { id: string; toJid: string; error: string | null }[];
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function StatTile({
  label, value, sub, icon, gradient, href,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; gradient: string; href: string;
}) {
  return (
    <Link href={href}>
      <Card className="group relative overflow-hidden p-6 transition-all hover:shadow-lg hover:shadow-slate-200/50">
        <div className={`absolute -right-4 -top-4 h-24 w-24 rounded-full ${gradient} opacity-10 transition-transform group-hover:scale-125`} />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-3xl font-bold tracking-tight text-slate-900">{value}</p>
            <p className="mt-1 text-sm font-medium text-slate-500">{label}</p>
            {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
          </div>
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${gradient} text-white shadow-md`}>
            {icon}
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function AdminOverview() {
  const { data: tenantsData, loading: tLoading } = useAdminApi<Overview>("/api/admin/tenants");
  const { data: opsData } = useAdminApi<Ops>("/api/admin/operations");

  const tenants = tenantsData?.items ?? [];
  const active = tenants.filter((t) => t.status === "ACTIVE").length;
  const suspended = tenants.filter((t) => t.status === "SUSPENDED").length;
  const totalUsers = tenants.reduce((s, t) => s + t.userCount, 0);
  const totalChannels = tenants.reduce((s, t) => s + t.channelCount, 0);
  const totalMsgs = tenants.reduce((s, t) => s + t.messageCount30d, 0);
  const failedOutbox = opsData?.outbox.find((o) => o.status === "FAILED")?.count ?? 0;
  const queuedOutbox = opsData?.outbox.find((o) => o.status === "QUEUED")?.count ?? 0;
  const activeLeases = (opsData?.locks ?? []).filter((l) => l.isHeld);

  return (
    <AdminShell title="Ringkasan">
      <div className="space-y-8">
        {/* Stat tiles */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Tenant Aktif" value={active} sub={`${suspended} ditangguhkan`}
            icon={<Storefront size={24} />} gradient="bg-gradient-to-br from-green-500 to-green-700"
            href="/admin/tenants" />
          <StatTile label="Total Pengguna" value={totalUsers}
            icon={<UsersThree size={24} />} gradient="bg-gradient-to-br from-blue-500 to-blue-700"
            href="/admin/tenants" />
          <StatTile label="Saluran" value={totalChannels}
            icon={<ChatCircleDots size={24} />} gradient="bg-gradient-to-br from-violet-500 to-violet-700"
            href="/admin/channels" />
          <StatTile label="Pesan 30 Hari" value={totalMsgs}
            icon={<PaperPlaneRight size={24} />} gradient="bg-gradient-to-br from-amber-500 to-orange-600"
            href="/admin/plans" />
        </div>

        {/* Worker + Queue health */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Outbox */}
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Outbox Worker</h3>
              {failedOutbox > 0 && (
                <Link href="/admin/operations">
                  <Badge variant="destructive" className="cursor-pointer text-xs">
                    {failedOutbox} GAGAL
                  </Badge>
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {["QUEUED", "SENDING", "SENT", "FAILED"].map((s) => {
                const count = opsData?.outbox.find((o) => o.status === s)?.count ?? 0;
                const colors: Record<string, string> = {
                  QUEUED: "text-amber-600 bg-amber-50",
                  SENDING: "text-blue-600 bg-blue-50",
                  SENT: "text-green-600 bg-green-50",
                  FAILED: "text-red-600 bg-red-50",
                };
                return (
                  <div key={s} className={`rounded-xl p-3 text-center ${colors[s]}`}>
                    <p className="text-xl font-bold">{count}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wide">{s}</p>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Active leases */}
          <Card className="p-6">
            <h3 className="mb-4 text-sm font-semibold text-slate-700">Lease Aktif</h3>
            <div className="space-y-2">
              {activeLeases.map((l) => (
                <div key={l.key} className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
                  <code className="text-xs font-medium text-green-800">{l.key}</code>
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
                    <Clock size={10} /> HELD
                  </span>
                </div>
              ))}
              {activeLeases.length === 0 && (
                <div className="flex items-center justify-center rounded-lg bg-slate-50 py-6 text-sm text-slate-400">
                  Tidak ada lease aktif
                </div>
              )}
            </div>
          </Card>

          {/* Recent tenants */}
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Tenant Terbaru</h3>
              <Link href="/admin/tenants" className="text-xs font-medium text-green-700 hover:underline">
                Lihat semua
              </Link>
            </div>
            <div className="space-y-2">
              {tenants.slice(0, 5).map((t) => (
                <Link key={t.id} href="/admin/tenants" className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-slate-50">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 rounded-full ${t.status === "ACTIVE" ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="text-sm font-medium text-slate-700">{t.name}</span>
                  </div>
                  <span className="text-xs text-slate-400">{t.userCount} user</span>
                </Link>
              ))}
              {tenants.length === 0 && !tLoading && (
                <p className="py-4 text-center text-sm text-slate-400">Belum ada tenant</p>
              )}
            </div>
          </Card>
        </div>

        {/* Failed messages alert */}
        {failedOutbox > 0 && (
          <Card className="border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-3">
              <XCircle size={20} className="shrink-0 text-red-600" weight="fill" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">
                  {failedOutbox} pesan gagal dikirim
                </p>
                <p className="text-xs text-red-600">
                  Pesan WhatsApp yang tidak terkirim ke pelanggan. Cek detail dan retry di halaman Operasional.
                </p>
              </div>
              <Link href="/admin/operations">
                <Badge variant="destructive" className="cursor-pointer">Retry</Badge>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
