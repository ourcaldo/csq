import { useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import type { ReactNode } from "react";
import { ClockCounterClockwise, Robot, User } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Select } from "@csq/ui/components/ui/select";
import { Input } from "@csq/ui/components/ui/input";
import { Button } from "@csq/ui/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@csq/ui/components/ui/table";

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
// agentId is null - human dashboard mutations are logged with agentId null.
function actorLabel(item: AuditLogItem): { label: string; icon: ReactNode } {
  if (item.agentId && item.agent) {
    return { label: item.agent.name, icon: <Robot size={14} /> };
  }
  return { label: "Tim", icon: <User size={14} /> };
}

// Render an opaque `unknown` payload as readable JSON (FEA-7 before/after
// disclosure). "-" for null/undefined so empty columns stay scannable.
function payloadText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function ActivityPage() {
  // FEA-7 (PRD 16): filters are pushed into the list URL as query params.
  const [page, setPage] = useState(1);
  const [agentFilter, setAgentFilter] = useState("");
  const [actionQuery, setActionQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");

  const url =
    `/api/dashboard/activity?page=${page}&pageSize=${PAGE_SIZE}` +
    (agentFilter ? `&agentId=${agentFilter}` : "") +
    (actionFilter ? `&action=${encodeURIComponent(actionFilter)}` : "") +
    (fromFilter ? `&from=${fromFilter}` : "") +
    (toFilter ? `&to=${toFilter}` : "");
  const { data, loading, error } = useApi<ListResult<AuditLogItem>>(url);

  // Agent options for the filter dropdown.
  const { data: agentsData } = useApi<{ items: { id: string; name: string }[] }>(
    "/api/dashboard/agents"
  );
  const agents = agentsData?.items ?? [];

  function applyActionFilter(e: FormEvent) {
    e.preventDefault();
    setActionFilter(actionQuery);
    setPage(1);
  }

  return (
    <DashboardShell
      title="Aktivitas"
      description="Riwayat audit setiap aksi agen dan tim, terbaru di atas."
    >
      {/* FEA-7 (PRD 16): agent / action / date-range filters. Agent and dates
          apply immediately; the free-text action search applies on submit so
          every keystroke does not refetch. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={agentFilter}
          onChange={(e) => {
            setAgentFilter(e.target.value);
            setPage(1);
          }}
          className="h-8 w-auto text-xs"
          aria-label="Filter agent"
        >
          <option value="">Semua agent</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <form onSubmit={applyActionFilter} className="flex items-center gap-2">
          <Input
            placeholder="Cari aksi…"
            value={actionQuery}
            onChange={(e) => setActionQuery(e.target.value)}
            className="h-8 max-w-40 text-xs"
          />
          <Button type="submit" variant="secondary" size="sm">
            Cari
          </Button>
        </form>
        <Input
          type="date"
          value={fromFilter}
          onChange={(e) => {
            setFromFilter(e.target.value);
            setPage(1);
          }}
          className="h-8 w-auto text-xs"
          aria-label="Dari tanggal"
        />
        <Input
          type="date"
          value={toFilter}
          onChange={(e) => {
            setToFilter(e.target.value);
            setPage(1);
          }}
          className="h-8 w-auto text-xs"
          aria-label="Sampai tanggal"
        />
      </div>

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
                    {/* FEA-7 (PRD 16): expandable before/after values. */}
                    <TableHead>Detail</TableHead>
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
                          {item.customerPhone ?? "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(item.createdAt)}
                        </TableCell>
                        <TableCell>
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-slate-700">
                              Sebelum / Sesudah
                            </summary>
                            <div className="mt-2 w-64 max-w-full space-y-2">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  Sebelum
                                </p>
                                <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs leading-relaxed text-muted-foreground">
                                  {payloadText(item.beforeValue)}
                                </pre>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  Sesudah
                                </p>
                                <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs leading-relaxed text-muted-foreground">
                                  {payloadText(item.afterValue)}
                                </pre>
                              </div>
                            </div>
                          </details>
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
