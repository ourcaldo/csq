import { useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult, SupportTicket } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { Badge } from "@csq/ui/components/ui/badge";
import { Button } from "@csq/ui/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";

const PAGE_SIZE = 20;

function statusBadge(status: SupportTicket["status"]) {
  return status === "RESOLVED" ? (
    <Badge variant="success">Selesai</Badge>
  ) : (
    <Badge variant="warning">Terbuka</Badge>
  );
}

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

// FEA-3 (PRD 16): tickets the agent created from conversations. OWNER and
// STAFF can read; only OWNER can close a ticket.
export default function TicketsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const [page, setPage] = useState(1);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const url = `/api/dashboard/tickets?page=${page}&pageSize=${PAGE_SIZE}`;
  const { data, loading, error, refresh } = useApi<ListResult<SupportTicket>>(url);

  async function onClose(ticket: SupportTicket) {
    setClosingId(ticket.id);
    setPageError(null);
    try {
      await apiSend<SupportTicket>(`/api/dashboard/tickets/${ticket.id}`, "POST");
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal menutup tiket.");
    } finally {
      setClosingId(null);
    }
  }

  return (
    <DashboardShell
      title="Tiket"
      description="Tiket dukungan yang dibuat agen dari percakapan pelanggan."
    >
      {pageError && <p className="mb-4 text-sm text-destructive">{pageError}</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <StateNotice variant="loading" message="Memuat tiket…" />}
      {!loading && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subjek</TableHead>
                  <TableHead>Isi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Percakapan</TableHead>
                  <TableHead className="hidden sm:table-cell">Dibuat</TableHead>
                  {isOwner && <TableHead className="text-right">Aksi</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={isOwner ? 6 : 5}>
                      <StateNotice variant="empty" message="Belum ada tiket." />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-[16rem] font-medium">{t.subject}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {t.body}
                    </TableCell>
                    <TableCell>{statusBadge(t.status)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {t.conversationId ? (
                        <a
                          href={`/dashboard/inbox?c=${encodeURIComponent(t.conversationId)}`}
                          className="text-primary underline"
                        >
                          Lihat
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatDate(t.createdAt)}
                    </TableCell>
                    {isOwner && (
                      <TableCell className="text-right">
                        {t.status === "OPEN" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={closingId === t.id}
                            onClick={() => onClose(t)}
                          >
                            Tutup
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data && (
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
  // STAFF can read tickets (FEA-3); closing is OWNER-only in the API.
  async () => ({ props: {} })
);
