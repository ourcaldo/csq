// /dashboard/campaigns - the list page. The create/edit wizard moved to its
// own pages (/dashboard/campaigns/baru and /dashboard/campaigns/[id]) at the
// owner's request (2026-11-10): no more popup. This page keeps the stat
// cards, the table with activate/pause/delete, and the runs dialog.
import { useState } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { withFeature } from "@csq/core/lib/auth";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type {
  CampaignRow,
  CampaignRunRow,
} from "@csq/core/types/campaign";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@csq/ui/components/ui/button";
import { CampaignTable } from "@/components/dashboard/campaigns/campaign-table";
import { CampaignRunsDialog } from "@/components/dashboard/campaigns/campaign-runs-dialog";

export default function CampaignsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const canManage = session?.user.role === "OWNER" || !!session?.user.canRunCampaigns;

  const campaigns = useApi<{ items: CampaignRow[]; stats?: { active: number; sentThisMonth: number } }>(
    "/api/dashboard/campaigns"
  );

  const [pageError, setPageError] = useState<string | null>(null);

  // Run history dialog
  const [runsFor, setRunsFor] = useState<CampaignRow | null>(null);
  const [runs, setRuns] = useState<CampaignRunRow[] | null>(null);
  const [runDetail, setRunDetail] = useState<CampaignRunRow | null>(null);

  // Delete confirm
  const [toDelete, setToDelete] = useState<CampaignRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function onActivate(c: CampaignRow) {
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/campaigns/${c.id}/activate`, "POST");
      campaigns.refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal mengaktifkan kampanye.");
    }
  }

  async function onPause(c: CampaignRow) {
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/campaigns/${c.id}/pause`, "POST");
      campaigns.refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal menjeda kampanye.");
    }
  }

  async function onDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/campaigns/${toDelete.id}`, "DELETE");
      setToDelete(null);
      campaigns.refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal menghapus kampanye.");
    } finally {
      setDeleting(false);
    }
  }

  async function openRuns(c: CampaignRow) {
    setRunsFor(c);
    setRuns(null);
    setRunDetail(null);
    try {
      const data = await apiFetch<{ runs: CampaignRunRow[] }>(
        `/api/dashboard/campaigns/${c.id}/runs`
      );
      setRuns(data.runs);
    } catch {
      setRuns([]);
    }
  }

  async function openRunDetail(runId: string) {
    if (!runsFor) return;
    try {
      const data = await apiFetch<{ run: CampaignRunRow }>(
        `/api/dashboard/campaigns/${runsFor.id}/runs?runId=${runId}&pageSize=200`
      );
      setRunDetail(data.run);
    } catch {
      setRunDetail(null);
    }
  }

  return (
    <DashboardShell
      title="Kampanye"
      description="Kirim pesan promosi ke banyak kontak sekaligus, dengan jadwal dan tempo yang terkontrol."
      actions={
        canManage ? (
          <Button onClick={() => router.push("/dashboard/campaigns/baru")}>
            Kampanye Baru
          </Button>
        ) : undefined
      }
    >
      {!canManage && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Anda tidak punya izin kampanye. Minta owner mengaktifkan &quot;Boleh jalankan kampanye&quot;
          di halaman Tim.
        </p>
      )}
      {pageError && <p className="mb-4 text-sm text-destructive">{pageError}</p>}
      {!campaigns.loading && !campaigns.error && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Kampanye
            </p>
            <p className="mt-3 text-2xl font-bold text-slate-900">
              {campaigns.data?.items.length ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Aktif
            </p>
            <p className="mt-3 text-2xl font-bold text-green-700">
              {campaigns.data?.stats?.active ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Terkirim Bulan Ini
            </p>
            <p className="mt-3 text-2xl font-bold text-slate-900">
              {campaigns.data?.stats?.sentThisMonth ?? 0}
            </p>
          </div>
        </div>
      )}
      <CampaignTable
        items={campaigns.data?.items ?? []}
        loading={campaigns.loading}
        error={campaigns.error}
        canManage={canManage}
        onRuns={openRuns}
        onEdit={(c) => router.push(`/dashboard/campaigns/${c.id}`)}
        onActivate={onActivate}
        onPause={onPause}
        onDelete={setToDelete}
      />

      <CampaignRunsDialog
        open={runsFor !== null}
        title={`Riwayat - ${runsFor?.name ?? ""}`}
        runs={runs}
        runDetail={runDetail}
        onClose={() => setRunsFor(null)}
        onToggleDetail={(id) =>
          runDetail?.id === id ? setRunDetail(null) : openRunDetail(id)
        }
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Kampanye"
        description={`Yakin ingin menghapus kampanye "${toDelete?.name}"? Riwayat kirimnya ikut terhapus.`}
        confirmLabel="Hapus"
        destructive
        loading={deleting}
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withFeature(
  "campaigns",
  async () => ({ props: {} })
);
