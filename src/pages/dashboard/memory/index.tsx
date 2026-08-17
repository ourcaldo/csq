import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult, Memory, MemoryImportance } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PAGE_SIZE = 20;

const IMPORTANCE_VALUES: MemoryImportance[] = ["LOW", "MEDIUM", "HIGH"];

const IMPORTANCE_LABEL: Record<MemoryImportance, string> = {
  LOW: "Rendah",
  MEDIUM: "Sedang",
  HIGH: "Tinggi",
};

// Narrow a <select> string to MemoryImportance without `as`.
function toImportance(v: string): MemoryImportance {
  return IMPORTANCE_VALUES.find((t) => t === v) ?? "MEDIUM";
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

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

export default function MemoryPage() {
  const [agentFilter, setAgentFilter] = useState("");
  const [page, setPage] = useState(1);

  const [toDelete, setToDelete] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/dashboard/memory?page=${page}&pageSize=${PAGE_SIZE}${
    agentFilter ? `&agentId=${encodeURIComponent(agentFilter)}` : ""
  }`;
  const { data, loading, error: fetchError, refresh } = useApi<ListResult<Memory>>(url);

  // Distinct agentIds from the current page — used to populate the filter
  // dropdown. There's no /api/dashboard/agents list route, so we derive the
  // options from what's loaded. Acceptable for the MVP demo.
  const agentOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const m of data?.items ?? []) seen.add(m.agentId);
    return Array.from(seen);
  }, [data]);

  async function changeImportance(mem: Memory, importance: MemoryImportance) {
    setBusyId(mem.id);
    setError(null);
    try {
      await apiSend<Memory>(`/api/dashboard/memory/update?id=${encodeURIComponent(mem.id)}`, "PUT", {
        importance,
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah importance.");
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/memory/${toDelete.id}`, "DELETE");
      setToDelete(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus memori.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DashboardShell title="Memori" description="Ingatan yang disimpan agen dari percakapan.">
      <div className="mb-4 flex items-center gap-2">
        <Select
          value={agentFilter}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            setAgentFilter(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        >
          <option value="">Semua agen</option>
          {agentOptions.map((id) => (
            <option key={id} value={id}>
              Agen {shortId(id)}
            </option>
          ))}
        </Select>
      </div>

      {fetchError && <p className="mb-4 text-sm text-destructive">{fetchError}</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <StateNotice variant="loading" message="Memuat memori…" />}
      {!loading && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kunci</TableHead>
                  <TableHead>Nilai</TableHead>
                  <TableHead>Agen</TableHead>
                  <TableHead>Penting</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <StateNotice variant="empty" message="Belum ada memori." />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.key}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {m.value}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{shortId(m.agentId)}</TableCell>
                    <TableCell>
                      <Select
                        value={m.importance}
                        disabled={busyId === m.id}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                          changeImportance(m, toImportance(e.target.value))
                        }
                        className="h-8 w-28 py-1 text-xs"
                      >
                        {IMPORTANCE_VALUES.map((v) => (
                          <option key={v} value={v}>
                            {IMPORTANCE_LABEL[v]}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(m.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setToDelete(m)}
                      >
                        Hapus
                      </Button>
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
        title="Hapus Memori"
        description={`Yakin ingin menghapus memori "${toDelete?.key}"?`}
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
