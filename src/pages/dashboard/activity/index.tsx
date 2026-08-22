import { useState } from "react";
import type { GetServerSideProps } from "next";
import type { ReactNode } from "react";
import { ClockCounterClockwise, Robot, User } from "@phosphor-icons/react";
import { withAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

const PAGE_SIZE = 20;

// Local client-side types mirroring the serialized AuditLog row (see
// src/types/dashboard.ts header for why we don't import Prisma types here).
type ApprovalStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

type AuditLogItem = {
  id: string;
  tenantId: string;
  agentId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue: unknown;
  afterValue: unknown;
  approvalStatus: ApprovalStatus;
  customerPhone: string | null;
  createdAt: string;
  agent?: { id: string; name: string } | null;
};

function formatDateTime(iso: string): string {
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

function approvalBadge(status: ApprovalStatus): ReactNode {
  if (status === "PENDING") return <BadgeStatus tone="amber">Menunggu</BadgeStatus>;
  if (status === "APPROVED") return <BadgeStatus tone="green">Disetujui</BadgeStatus>;
  if (status === "REJECTED") return <BadgeStatus tone="red">Ditolak</BadgeStatus>;
  return <BadgeStatus tone="neutral">Netral</BadgeStatus>;
}

// Attribute an entry to a named agent, or to "Tim" (the human staff) when
// agentId is null — human dashboard mutations are logged with agentId null.
function actorLabel(item: AuditLogItem): { label: string; icon: ReactNode } {
  if (item.agentId && item.agent) {
    return { label: item.agent.name, icon: <Robot size={14} /> };
  }
  return { label: "Tim", icon: <User size={14} /> };
}

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const url = `/api/dashboard/activity?page=${page}&pageSize=${PAGE_SIZE}`;
  const { data, loading, error } = useApi<ListResult<AuditLogItem>>(url);

  return (
    <DashboardShell
      title="Aktivitas"
      description="Riwayat audit setiap aksi agen dan tim, terbaru di atas."
    >
      {loading && <LoadingSkeleton rows={6} />}
      {error && <StateNotice variant="error" message={error} />}

      {!loading && !error && (
        <>
          {data && data.items.length === 0 ? (
            <EmptyState
              icon={<ClockCounterClockwise size={24} />}
              title="Belum ada aktivitas"
              description="Aksi agen dan perubahan data oleh tim akan tercatat di sini."
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Aksi</TableHead>
                    <TableHead>Entitas</TableHead>
                    <TableHead>Aktor</TableHead>
                    <TableHead>Persetujuan</TableHead>
                    <TableHead className="hidden sm:table-cell">Telepon</TableHead>
                    <TableHead>Waktu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((item) => {
                    const actor = actorLabel(item);
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <BadgeStatus tone="blue">{item.action}</BadgeStatus>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-900">
                              {item.entityType}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {item.entityId}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                            <span className="text-slate-400">{actor.icon}</span>
                            {actor.label}
                          </span>
                        </TableCell>
                        <TableCell>{approvalBadge(item.approvalStatus)}</TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {item.customerPhone ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(item.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {data && data.items.length > 0 && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
