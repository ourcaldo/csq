import { useState } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@/lib/auth";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { DataSource, DataSourceStatusResult, DataSourceType, ListResult } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PAGE_SIZE = 20;

const TYPE_LABEL: Record<DataSourceType, string> = {
  MANUAL: "Manual",
  EXCEL: "Excel",
  GOOGLE_SHEETS: "Google Sheets",
};

function statusBadge(status: string) {
  if (status === "ACTIVE") return <Badge variant="success">Aktif</Badge>;
  if (status === "ERROR") return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Nonaktif</Badge>;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Belum pernah";
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

export default function SourcesPage() {
  const [page, setPage] = useState(1);

  const [toDelete, setToDelete] = useState<DataSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, DataSourceStatusResult>>({});
  const [error, setError] = useState<string | null>(null);

  const url = `/api/dashboard/sources?page=${page}&pageSize=${PAGE_SIZE}`;
  const { data, loading, error: fetchError, refresh } = useApi<ListResult<DataSource>>(url);

  async function checkStatus(source: DataSource) {
    setCheckingId(source.id);
    setError(null);
    try {
      const result = await apiFetch<DataSourceStatusResult>(
        `/api/dashboard/sources/status?id=${encodeURIComponent(source.id)}`
      );
      setStatusMap((prev) => ({ ...prev, [source.id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memeriksa status.");
    } finally {
      setCheckingId(null);
    }
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/sources/${toDelete.id}`, "DELETE");
      setToDelete(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus sumber data.");
    } finally {
      setDeleting(false);
    }
  }

  function statusOf(source: DataSource): string {
    return statusMap[source.id]?.status ?? source.status;
  }

  function lastSyncOf(source: DataSource): string | null {
    return statusMap[source.id]?.lastSyncAt ?? source.lastSyncAt;
  }

  return (
    <DashboardShell
      title="Sumber Data"
      description="Excel, Google Sheets, dan sumber data lain yang tersambung."
    >
      {fetchError && <p className="mb-4 text-sm text-destructive">{fetchError}</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <StateNotice variant="loading" message="Memuat sumber data…" />}
      {!loading && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sinkronisasi Terakhir</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <StateNotice
                        variant="empty"
                        message="Belum ada sumber data. Impor Excel atau sambungkan Google Sheets dari halaman lain."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{TYPE_LABEL[s.type]}</Badge>
                    </TableCell>
                    <TableCell>{statusBadge(statusOf(s))}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(lastSyncOf(s))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={checkingId === s.id}
                          onClick={() => checkStatus(s)}
                        >
                          {checkingId === s.id ? "Memeriksa…" : "Segarkan Status"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setToDelete(s)}
                        >
                          Hapus
                        </Button>
                      </div>
                    </TableCell>
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

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Sumber Data"
        description={`Yakin ingin memutuskan dan menghapus "${toDelete?.name}"?`}
        confirmLabel="Hapus"
        destructive
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
