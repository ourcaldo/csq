import { useState } from "react";
import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@/types/dashboard";
import type { Scenario, ScenarioStatus, ScenarioTriggerType } from "@/types/scenario";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Pagination } from "@/components/dashboard/pagination";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const PAGE_SIZE = 20;

const TRIGGER_LABEL: Record<ScenarioTriggerType, string> = {
  ON_NEW_CONVERSATION: "Percakapan baru",
  ON_PURCHASE: "Pesanan dibuat",
  ON_TAG_ADDED: "Tag ditambahkan",
  ON_SCHEDULE: "Jadwal",
  ON_NO_REPLY: "Tanpa balasan pelanggan",
};

const STATUS_LABEL: Record<ScenarioStatus, string> = {
  DRAFT: "Draf",
  ACTIVE: "Aktif",
  PAUSED: "Jeda",
};

const STATUS_TONE: Record<ScenarioStatus, "neutral" | "green" | "amber"> = {
  DRAFT: "neutral",
  ACTIVE: "green",
  PAUSED: "amber",
};

export default function ScenariosPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const canEdit = session?.user?.role === "OWNER" || session?.user?.role === "STAFF";
  const isOwner = session?.user?.role === "OWNER";

  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Scenario | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const url = `/api/dashboard/scenarios?page=${page}&pageSize=${PAGE_SIZE}`;
  const { data, loading, error, refresh } = useApi<ListResult<Scenario>>(url);

  async function onCreate() {
    // Quick-create: name + trigger chosen inline, then open the builder.
    setCreating(true);
    setFormError(null);
    try {
      const created = await apiSend<Scenario>("/api/dashboard/scenarios", "POST", {
        name: "Skenario Baru",
        triggerType: "ON_NEW_CONVERSATION",
      });
      void router.push(`/dashboard/scenarios/${created.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal membuat skenario.");
    } finally {
      setCreating(false);
    }
  }

  async function onToggleActive(s: Scenario) {
    setBusyId(s.id);
    setFormError(null);
    try {
      if (s.status === "ACTIVE") {
        await apiSend<Scenario>(`/api/dashboard/scenarios/${s.id}/pause`, "POST");
      } else {
        const res = await apiSend<{ scenario: Scenario; warnings: string[] }>(
          `/api/dashboard/scenarios/${s.id}/activate`,
          "POST"
        );
        if (res.warnings.length > 0) {
          setFormError(`Aktif dengan peringatan: ${res.warnings.join(" ")}`);
        }
      }
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await apiSend(`/api/dashboard/scenarios/${toDelete.id}`, "DELETE");
      setToDelete(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus skenario.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DashboardShell
      title="Skenario"
      description="Otomasi percakapan: survei, after-sales, dan alur pemicu lainnya."
      actions={
        canEdit ? (
          <Button onClick={onCreate} disabled={creating}>
            {creating ? "Membuat…" : "Tambah Skenario"}
          </Button>
        ) : undefined
      }
    >
      {formError && <p className="mb-4 text-sm text-destructive">{formError}</p>}
      {loading && <StateNotice variant="loading" message="Memuat skenario…" />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Pemicu</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <StateNotice
                        variant="empty"
                        message="Belum ada skenario. Klik 'Tambah Skenario' untuk mulai."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {data?.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/scenarios/${s.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {s.name}
                      </Link>
                      {s.description && (
                        <p className="max-w-md truncate text-xs text-slate-500">{s.description}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{TRIGGER_LABEL[s.triggerType]}</Badge>
                    </TableCell>
                    <TableCell>
                      <BadgeStatus tone={STATUS_TONE[s.status]}>
                        {STATUS_LABEL[s.status]}
                      </BadgeStatus>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/scenarios/${s.id}`}>
                          <Button variant="outline" size="sm">
                            Edit
                          </Button>
                        </Link>
                        {isOwner && (
                          <Button
                            variant={s.status === "ACTIVE" ? "outline" : "default"}
                            size="sm"
                            disabled={busyId === s.id}
                            onClick={() => onToggleActive(s)}
                          >
                            {s.status === "ACTIVE" ? "Jeda" : "Aktifkan"}
                          </Button>
                        )}
                        {isOwner && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setToDelete(s)}
                          >
                            Hapus
                          </Button>
                        )}
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
        title="Hapus Skenario"
        description={`Yakin ingin menghapus skenario "${toDelete?.name}"? Run yang sudah berjalan tidak terpengaruh.`}
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
