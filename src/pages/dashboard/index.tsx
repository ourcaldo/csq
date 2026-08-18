// Dashboard overview — the landing page after login. Stat cards for the key
// counts, plus recent conversations and pending approvals (owner). All cards
// link into their sections.
import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { withAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@/types/dashboard";
import type { ConversationListItem } from "@/types/inbox";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { EmptyState } from "@/components/dashboard/empty-state";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import {
  Package,
  ShoppingCart,
  ChatCircleDots,
  SealCheck,
  ArrowRight,
  Robot,
} from "@phosphor-icons/react";

type ApprovalItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "NONE";
  createdAt: string;
  agent?: { id: string; name: string } | null;
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }) +
    " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export default function DashboardIndex() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const products = useApi<ListResult<unknown>>("/api/dashboard/products?pageSize=1");
  const orders = useApi<ListResult<unknown>>("/api/dashboard/orders?pageSize=1");
  const conversations = useApi<ListResult<ConversationListItem>>(
    "/api/dashboard/inbox/conversations?pageSize=5"
  );
  // Always called (hook order must be stable). Staff get 403 from this OWNER-only
  // route; we just don't render the approvals card for non-owners.
  const approvals = useApi<ListResult<ApprovalItem>>("/api/dashboard/approvals?pageSize=5");

  const pendingApprovals = (approvals.data?.items ?? []).filter(
    (a) => a.status === "PENDING"
  );

  return (
    <DashboardShell title="Ringkasan" description="Pintasan ke setiap bagian dashboard.">
      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Produk"
          value={products.loading ? "…" : products.data?.total ?? 0}
          icon={<Package size={18} />}
          tone="green"
        />
        <StatCard
          label="Pesanan"
          value={orders.loading ? "…" : orders.data?.total ?? 0}
          icon={<ShoppingCart size={18} />}
          tone="blue"
        />
        <StatCard
          label="Percakapan"
          value={conversations.loading ? "…" : conversations.data?.total ?? 0}
          icon={<ChatCircleDots size={18} />}
          tone="default"
        />
        <StatCard
          label="Approval Menunggu"
          value={isOwner ? (approvals.loading ? "…" : pendingApprovals.length) : "—"}
          icon={<SealCheck size={18} />}
          tone="amber"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Recent conversations */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Percakapan Terbaru</h2>
            <Link
              href="/dashboard/inbox"
              className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-800"
            >
              Buka inbox <ArrowRight size={12} />
            </Link>
          </div>
          {conversations.loading && <LoadingSkeleton rows={3} />}
          {conversations.error && <p className="text-sm text-red-600">{conversations.error}</p>}
          {!conversations.loading && !conversations.error && (conversations.data?.items.length ?? 0) === 0 && (
            <EmptyState
              title="Belum ada percakapan"
              description="Percakapan pelanggan via WhatsApp akan muncul di sini."
            />
          )}
          <div className="space-y-2">
            {conversations.data?.items.map((c) => (
              <Link
                key={c.id}
                href="/dashboard/inbox"
                className="flex items-center justify-between rounded-lg border border-slate-100 p-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {c.contact?.name ?? c.customerPhone}
                  </p>
                  <p className="text-xs text-slate-500">{c.customerPhone}</p>
                </div>
                {c.assignee ? (
                  <BadgeStatus tone="neutral">Tim</BadgeStatus>
                ) : c.assignedAgent ? (
                  <BadgeStatus tone="blue"><Robot size={11} weight="fill" /> AI</BadgeStatus>
                ) : (
                  <BadgeStatus tone="amber">Menunggu</BadgeStatus>
                )}
              </Link>
            ))}
          </div>
        </div>

        {/* Pending approvals */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Approval Menunggu</h2>
            {isOwner && (
              <Link
                href="/dashboard/approvals"
                className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-800"
              >
                Semua <ArrowRight size={12} />
              </Link>
            )}
          </div>
          {!isOwner ? (
            <EmptyState
              title="Khusus owner"
              description="Approval aksi tulang agent hanya bisa dilihat oleh owner."
            />
          ) : approvals.loading ? (
            <LoadingSkeleton rows={3} />
          ) : approvals.error ? (
            <p className="text-sm text-red-600">{approvals.error}</p>
          ) : pendingApprovals.length === 0 ? (
            <EmptyState
              title="Tidak ada approval menunggu"
              description="Aksi tulang agent yang butuh persetujuan akan muncul di sini."
            />
          ) : (
            <div className="space-y-2">
              {pendingApprovals.map((a) => (
                <Link
                  key={a.id}
                  href="/dashboard/approvals"
                  className="block rounded-lg border border-slate-100 p-3 hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-900">{a.action}</p>
                    <span className="text-xs text-slate-400">{timeLabel(a.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {a.entityType} · {a.agent?.name ?? "Agent"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
