import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { withAuth } from "@/lib/auth";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type {
  DataSource,
  DataSourceStatusResult,
  DataSourceType,
  ListResult,
} from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { AddSourceDialog } from "@/components/dashboard/sources/add-source-dialog";
import { SpreadsheetPicker } from "@/components/dashboard/sources/spreadsheet-picker";
import { Dialog } from "@/components/ui/dialog";

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

type GoogleStatus = { connected: boolean; email?: string };

export default function SourcesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);

  const [toDelete, setToDelete] = useState<DataSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, DataSourceStatusResult>>({});
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [pickerSourceId, setPickerSourceId] = useState<string | null>(null);

  const url = `/api/dashboard/sources?page=${page}&pageSize=${PAGE_SIZE}`;
  const { data, loading, error: fetchError, refresh } = useApi<ListResult<DataSource>>(url);
  const google = useApi<GoogleStatus>("/api/dashboard/sources/google");

  // After Google OAuth, the callback redirects here with ?sheets_source=<id>.
  // Open the spreadsheet picker for that source, then clean the URL so a refresh
  // doesn't reopen it.
  useEffect(() => {
    const raw = router.query.sheets_source;
    const src = typeof raw === "string" ? raw : undefined;
    if (src) {
      setPickerSourceId(src);
      void router.replace({ pathname: router.pathname }, undefined, { shallow: true });
    }
  }, [router.query.sheets_source, router]);

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

  async function syncNow(source: DataSource) {
    setSyncingId(source.id);
    setError(null);
    try {
      await apiSend(`/api/import/sheets/sync`, "POST", { sourceId: source.id });
      refresh();
      google.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyinkronkan spreadsheet.");
    } finally {
      setSyncingId(null);
    }
  }

  async function disconnectGoogle() {
    setGoogleBusy(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/sources/google/disconnect`, "POST");
      google.refresh();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memutuskan akun Google.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function addSpreadsheet() {
    setGoogleBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ id: string }>(
        `/api/dashboard/sources/sheets/create`,
        "POST"
      );
      setPickerSourceId(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah spreadsheet.");
    } finally {
      setGoogleBusy(false);
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

  const googleConnected = google.data?.connected ?? false;
  const googleEmail = google.data?.email;

  return (
    <DashboardShell
      title="Sumber Data"
      description="Excel, Google Sheets, dan sumber data lain yang tersambung."
      actions={
        <div className="flex items-center gap-2">
          {googleConnected ? (
            <>
              <Badge variant="success">Google: {googleEmail ?? "terhubung"}</Badge>
              <Button size="sm" variant="outline" onClick={addSpreadsheet} disabled={googleBusy}>
                Tambah Spreadsheet
              </Button>
              <Button size="sm" variant="outline" onClick={disconnectGoogle} disabled={googleBusy}>
                Disconnect
              </Button>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/api/import/sheets/auth">
              <Button size="sm" disabled={googleBusy}>Connect Google Account</Button>
            </a>
          )}
          <Button onClick={() => setAddOpen(true)}>Tambah Sumber Data</Button>
        </div>
      }
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
                        message="Belum ada sumber data. Klik Tambah Sumber Data untuk mulai."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.name}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {s.dataType}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{TYPE_LABEL[s.type]}</Badge>
                    </TableCell>
                    <TableCell>{statusBadge(statusOf(s))}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(lastSyncOf(s))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {s.type === "GOOGLE_SHEETS" && s.status === "ACTIVE" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={syncingId === s.id}
                            onClick={() => syncNow(s)}
                          >
                            {syncingId === s.id ? "Menyinkronkan…" : "Sync Sekarang"}
                          </Button>
                        )}
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

      <AddSourceDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        googleConnected={googleConnected}
        googleEmail={googleEmail}
        onConnectionChanged={() => google.refresh()}
        onOpenPicker={(id) => setPickerSourceId(id)}
        onImported={() => refresh()}
      />

      {/* Spreadsheet picker (post-OAuth or "Tambah Spreadsheet"). */}
      <Dialog
        open={pickerSourceId !== null}
        onClose={() => setPickerSourceId(null)}
        title="Pilih Spreadsheet"
        description="Pilih spreadsheet dan tab, lalu petakan kolom untuk diimpor."
        className="max-w-xl"
      >
        {pickerSourceId && (
          <SpreadsheetPicker
            sourceId={pickerSourceId}
            onClose={() => setPickerSourceId(null)}
            onDone={() => {
              setPickerSourceId(null);
              refresh();
              google.refresh();
            }}
          />
        )}
      </Dialog>

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
