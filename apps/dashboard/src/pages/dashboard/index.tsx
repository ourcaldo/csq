// Dashboard overview - the landing page after login. Stat cards for the key
// counts (products, orders, conversations, approvals, active agents, channel
// status, source health - FEA-7, PRD 16), plus recent conversations, pending
// approvals (owner), and the last agent actions. All cards link into their
// sections.
import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { withAuth } from "@csq/core/lib/auth";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@csq/core/types/dashboard";
import type { ConversationListItem } from "@csq/core/types/inbox";
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
  WhatsappLogo,
  Database,
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

// FEA-7 (PRD 16): minimal shapes of the agent / channel / source / activity
// list responses - only the fields the overview cards render.
type AgentSummary = { status: string };
type ChannelSummary = { status: string };
type SourceSummary = { status: string; lastSyncAt: string | null };
type ActivitySummary = { id: string; action: string; createdAt: string };

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

  // FEA-7 (PRD 16): agent / channel / source health + last agent actions.
  const agents = useApi<{ items: AgentSummary[] }>("/api/dashboard/agents");
  const channels = useApi<{ items: ChannelSummary[] }>("/api/dashboard/channels");
  const sources = useApi<ListResult<SourceSummary>>("/api/dashboard/sources?pageSize=100");
  const agentActivity = useApi<ListResult<ActivitySummary>>(
    "/api/dashboard/activity?pageSize=10"
  );

  const pendingApprovals = (approvals.data?.items ?? []).filter(
    (a) => a.status === "PENDING"
  );

  const agentItems = agents.data?.items ?? [];
  const activeAgents = agentItems.filter((a) => a.status === "ACTIVE").length;

  const channelItems = channels.data?.items ?? [];
  const connectedChannels = channelItems.filter((c) => c.status === "CONNECTED").length;
  const allChannelsConnected =
    channelItems.length > 0 && connectedChannels === channelItems.length;

  const sourceItems = sources.data?.items ?? [];
  const activeSources = sourceItems.filter((s) => s.status === "ACTIVE").length;
  const errorSources = sourceItems.filter((s) => s.status === "ERROR").length;
  let lastSync: string | null = null;
  for (const s of sourceItems) {
    if (s.lastSyncAt && (!lastSync || s.lastSyncAt > lastSync)) lastSync = s.lastSyncAt;
  }

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
          value={isOwner ? (approvals.loading ? "…" : pendingApprovals.length) : "-"}
          icon={<SealCheck size={18} />}
          tone="amber"
        />
        <StatCard
          label="Agent Aktif"
          value={agents.loading ? "…" : activeAgents}
          hint={`${agentItems.length} agent total`}
          icon={<Robot size={18} />}
          tone="green"
        />
        <StatCard
          label="Saluran WhatsApp"
          value={
            channels.loading
              ? "…"
              : channelItems.length === 0
                ? "Belum ada"
                : allChannelsConnected
                  ? "Terhubung"
                  : connectedChannels === 0
                    ? "Terputus"
                    : `${connectedChannels}/${channelItems.length} terhubung`
          }
          hint={`${connectedChannels} dari ${channelItems.length} saluran terhubung`}
          icon={<WhatsappLogo size={18} />}
          tone={allChannelsConnected ? "green" : "amber"}
        />
        <StatCard
          label="Sumber Data"
          value={sources.loading ? "…" : activeSources}
          hint={`${errorSources} error - sinkron terakhir ${
            lastSync ? timeLabel(lastSync) : "-"
          }`}
          icon={<Database size={18} />}
          tone="default"
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
                    {a.entityType} - {a.agent?.name ?? "Agent"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
        {/* FEA-7 (PRD 16): the last 10 agent actions, newest first. */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Aksi Agent Terakhir</h2>
            <Link
              href="/dashboard/activity"
              className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-800"
            >
              Semua <ArrowRight size={12} />
            </Link>
          </div>
          {agentActivity.loading && <LoadingSkeleton rows={3} />}
          {agentActivity.error && <p className="text-sm text-red-600">{agentActivity.error}</p>}
          {!agentActivity.loading &&
            !agentActivity.error &&
            (agentActivity.data?.items.length ?? 0) === 0 && (
              <EmptyState
                title="Belum ada aksi agent"
                description="Aksi agent akan tercatat di sini."
              />
            )}
          <div className="space-y-2">
            {agentActivity.data?.items.map((a) => (
              <Link
                key={a.id}
                href="/dashboard/activity"
                className="flex items-center justify-between rounded-lg border border-slate-100 p-3 hover:bg-slate-50"
              >
                <span className="min-w-0 truncate text-sm font-medium text-slate-900">
                  {a.action}
                </span>
                <span className="ml-2 shrink-0 text-xs text-slate-400">
                  {timeLabel(a.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
