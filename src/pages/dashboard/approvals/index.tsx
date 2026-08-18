// Approvals dashboard — OWNER-only queue of pending agent write actions.
// Lists PENDING approvals as cards with a before→after diff preview and
// Approve / Reject actions. Staff see a PERMISSION_DENIED notice (the API
// also enforces this server-side).
import { useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { SealCheck, CheckCircle, XCircle, Clock } from "@phosphor-icons/react";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// Local type for an approval row. Mirrors the Prisma-serialized shape from
// /api/dashboard/approvals. The richer fields (agent, params, resolvedAt…)
// are optional so the page tolerates the summary form the API currently
// returns while still rendering them when present.
type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "NONE";

type ApprovalItem = {
  id: string;
  tenantId?: string;
  agentId?: string;
  action: string;
  entityType: string;
  entityId: string;
  proposedBefore: unknown;
  proposedAfter: unknown;
  params?: unknown;
  status: ApprovalStatus;
  resolvedById?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  agent?: { id: string; name: string } | null;
};

const STATUS_TONE: Record<ApprovalStatus, "neutral" | "green" | "red" | "amber"> = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  NONE: "neutral",
};

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  NONE: "—",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

// Render an opaque `unknown` payload as readable JSON. Truncates long blobs so
// the card stays scannable; the full value is available in the DOM via title.
function renderPayload(value: unknown): { text: string; truncated: boolean } {
  if (value === null || value === undefined) {
    return { text: "—", truncated: false };
  }
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  const MAX = 240;
  if (text.length > MAX) {
    return { text: text.slice(0, MAX) + "…", truncated: true };
  }
  return { text, truncated: false };
}

// Normalize the API response into a flat list. The route currently returns a
// plain ApprovalSummary[] array; if a future version wraps it in ListResult
// (items/total/page), unwrap that here. No `as` — narrow via Array.isArray.
function toItems(
  data: ApprovalItem[] | ListResult<ApprovalItem> | null
): ApprovalItem[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.items;
}

export default function ApprovalsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data, loading, error, refresh } = useApi<ApprovalItem[] | ListResult<ApprovalItem>>(
    "/api/dashboard/approvals?pageSize=50"
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [toReject, setToReject] = useState<ApprovalItem | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = toItems(data);
  const pendingItems = items.filter((a) => a.status === "PENDING");

  async function onApprove(item: ApprovalItem) {
    setBusyId(item.id);
    setActionError(null);
    try {
      await apiSend(`/api/dashboard/approvals/${item.id}/approve`, "POST");
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menyetujui approval.");
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmReject() {
    if (!toReject) return;
    setRejecting(true);
    setActionError(null);
    try {
      await apiSend(`/api/dashboard/approvals/${toReject.id}/reject`, "POST");
      setToReject(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menolak approval.");
    } finally {
      setRejecting(false);
    }
  }

  // Non-owners: the API returns PERMISSION_DENIED; show a clear notice and
  // skip rendering the queue.
  if (!isOwner) {
    return (
      <DashboardShell
        title="Approval"
        description="Tindakan tulis agen yang menunggu persetujuan pemilik."
      >
        <StateNotice
          variant="error"
          message="Halaman ini hanya untuk pemilik (Owner). Akun Anda tidak memiliki akses."
        />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Approval"
      description="Tindakan tulis agen yang menunggu persetujuan pemilik."
    >
      {/* Summary count */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Menunggu Approval"
          value={pendingItems.length}
          hint="Tindakan agen yang perlu ditinjau"
          icon={<SealCheck size={20} weight="duotone" />}
          tone="amber"
        />
        <StatCard
          label="Total Antrian"
          value={items.length}
          hint="Semua approval pada sesi ini"
          icon={<Clock size={20} weight="duotone" />}
          tone="default"
        />
      </div>

      {actionError && (
        <p className="mb-4 text-sm text-destructive">{actionError}</p>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading && (
        <div className="space-y-3">
          <LoadingSkeleton rows={3} />
        </div>
      )}

      {!loading && !error && pendingItems.length === 0 && (
        <EmptyState
          icon={<SealCheck size={24} weight="duotone" />}
          title="Tidak ada approval menunggu"
          description="Saat ini tidak ada tindakan agen yang memerlukan persetujuan Anda."
        />
      )}

      {!loading && !error && pendingItems.length > 0 && (
        <div className="space-y-4">
          {pendingItems.map((item) => {
            const before = renderPayload(item.proposedBefore);
            const after = renderPayload(item.proposedAfter);
            const busy = busyId === item.id;
            const agentName = item.agent?.name ?? (item.agentId ? `Agen ${shortId(item.agentId)}` : "Agen");
            return (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                {/* Header row */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <BadgeStatus tone={STATUS_TONE[item.status]}>
                        {STATUS_LABEL[item.status]}
                      </BadgeStatus>
                      <span className="text-sm font-semibold text-slate-900">
                        {item.action}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.entityType} · ID {shortId(item.entityId)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => onApprove(item)}
                      disabled={busy}
                    >
                      <CheckCircle size={16} className="mr-1.5" />
                      {busy ? "Memproses…" : "Setujui"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setToReject(item)}
                      disabled={busy}
                    >
                      <XCircle size={16} className="mr-1.5" />
                      Tolak
                    </Button>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Diff preview */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Sebelum
                    </p>
                    <pre
                      className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700"
                      title={before.truncated ? renderPayload(item.proposedBefore).text : undefined}
                    >
                      {before.text}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Sesudah
                    </p>
                    <pre
                      className="max-h-48 overflow-auto rounded-lg bg-green-50 p-3 text-xs leading-relaxed text-slate-700"
                      title={after.truncated ? renderPayload(item.proposedAfter).text : undefined}
                    >
                      {after.text}
                    </pre>
                  </div>
                </div>

                {/* Footer meta */}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={14} />
                    {formatDate(item.createdAt)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <SealCheck size={14} />
                    {agentName}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={toReject !== null}
        title="Tolak Approval"
        description={`Yakin ingin menolak tindakan "${toReject?.action}" pada ${toReject?.entityType}? Tindakan agen tidak akan dijalankan.`}
        confirmLabel="Tolak"
        destructive
        loading={rejecting}
        onConfirm={onConfirmReject}
        onCancel={() => setToReject(null)}
      />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
