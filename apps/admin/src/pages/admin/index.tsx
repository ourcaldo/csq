import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Storefront, ChatCircleDots, Gear, Key, Tag } from "@phosphor-icons/react";
import Link from "next/link";

type Overview = {
  items: {
    id: string; name: string; slug: string; status: string;
    userCount: number; channelCount: number; conversationCount: number;
    messageCount30d: number; mediaBytes: number;
  }[];
};

type Operations = {
  locks: { key: string; isHeld: boolean; updatedAt: string }[];
  outbox: { status: string; count: number }[];
  failedMessages: { id: string; toJid: string; error: string | null }[];
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function StatCard({ label, value, icon, href }: { label: string; value: string | number; icon: React.ReactNode; href: string }) {
  return (
    <Link href={href}>
      <Card className="flex items-center gap-4 p-5 transition-colors hover:border-green-200">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-400">{label}</p>
        </div>
      </Card>
    </Link>
  );
}

export default function AdminOverview() {
  const { data: tenantsData, loading: tLoading } = useAdminApi<Overview>("/api/admin/tenants");
  const { data: opsData } = useAdminApi<Operations>("/api/admin/operations");

  const tenants = tenantsData?.items ?? [];
  const active = tenants.filter((t) => t.status === "ACTIVE").length;
  const suspended = tenants.filter((t) => t.status === "SUSPENDED").length;
  const totalMsgs = tenants.reduce((s, t) => s + t.messageCount30d, 0);
  const totalChannels = tenants.reduce((s, t) => s + t.channelCount, 0);
  const failedOutbox = opsData?.outbox.find((o) => o.status === "FAILED")?.count ?? 0;
  const queuedOutbox = opsData?.outbox.find((o) => o.status === "QUEUED")?.count ?? 0;

  return (
    <AdminShell title="Ringkasan">
      <div className="mx-auto max-w-6xl space-y-6">
        <h2 className="text-lg font-semibold text-slate-900">Ringkasan Platform</h2>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Tenant aktif" value={active} icon={<Storefront size={22} />} href="/admin/tenants" />
          <StatCard label="Tenant ditangguhkan" value={suspended} icon={<Storefront size={22} />} href="/admin/tenants" />
          <StatCard label="Saluran" value={totalChannels} icon={<ChatCircleDots size={22} />} href="/admin/channels" />
          <StatCard label="Pesan 30 hari" value={totalMsgs} icon={<Tag size={22} />} href="/admin/plans" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Outbox Worker</h3>
            <div className="flex gap-3">
              <Badge variant={queuedOutbox > 0 ? "default" : "secondary"}>
                QUEUED: {queuedOutbox}
              </Badge>
              <Badge variant={failedOutbox > 0 ? "destructive" : "secondary"}>
                FAILED: {failedOutbox}
              </Badge>
            </div>
            {failedOutbox > 0 && (
              <Link href="/admin/operations" className="mt-3 inline-block">
                <Button variant="outline" size="sm">
                  <Gear size={14} className="mr-1.5" /> Lihat detail
                </Button>
              </Link>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Lease Aktif</h3>
            {(opsData?.locks ?? []).filter((l) => l.isHeld).map((l) => (
              <div key={l.key} className="flex items-center justify-between py-1 text-sm">
                <code className="text-xs text-slate-500">{l.key}</code>
                <Badge variant="outline" className="text-xs">HELD</Badge>
              </div>
            ))}
            {(opsData?.locks ?? []).filter((l) => l.isHeld).length === 0 && (
              <p className="text-sm text-slate-400">Tidak ada lease aktif.</p>
            )}
          </Card>
        </div>

        {tLoading && <p className="text-sm text-slate-400">Memuat...</p>}
        {!tLoading && tenants.length === 0 && (
          <Card className="p-6">
            <p className="text-sm text-slate-500">
              Belum ada tenant. Buat tenant pertama dari halaman{" "}
              <Link href="/admin/tenants" className="text-green-700 underline">Tenant</Link>.
            </p>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
