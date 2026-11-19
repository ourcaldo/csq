// /dashboard/campaigns - the list page. The create/edit wizard moved to its
// own pages (/dashboard/campaigns/baru and /dashboard/campaigns/[id]) at the
// owner's request (2026-11-10): no more popup. Redesign 2026-11-18
// (docs/demo/new/kampanye_csq_campaign_manager.html): status filter tabs +
// search, metric cards, template-styled table.
import { useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { ArrowLeft, MagnifyingGlass, Megaphone, PaperPlaneTilt } from "@phosphor-icons/react";
import { withFeature } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type {
  CampaignRow,
} from "@csq/core/types/campaign";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@csq/ui/components/ui/button";
import { cn } from "@csq/ui/lib/utils";
import { CampaignTable } from "@/components/dashboard/campaigns/campaign-table";
import { CampaignRunsView } from "@/components/dashboard/campaigns/campaign-runs-view";
import { audienceLabel, scheduleLabel } from "@/components/dashboard/campaigns/format";

type FilterTab = "ALL" | "ACTIVE" | "PAUSED" | "DRAFT";

export default function CampaignsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const canManage = session?.user.role === "OWNER" || !!session?.user.canRunCampaigns;

  const campaigns = useApi<{ items: CampaignRow[]; stats?: { active: number; sentThisMonth: number } }>(
    "/api/dashboard/campaigns"
  );
  const channels = useApi<{
    items: { id: string; label: string; provider: string; status: string }[];
  }>("/api/dashboard/channels");

  const channelLabels = useMemo(() => {
    const m: Record<string, { label: string; provider: string }> = {};
    for (const c of channels.data?.items ?? []) {
      m[c.id] = { label: c.label, provider: c.provider };
    }
    return m;
  }, [channels.data]);

  // Filter tabs + search (template redesign)
  const [statusFilter, setStatusFilter] = useState<FilterTab>("ALL");
  const [search, setSearch] = useState("");

  const allItems = useMemo(() => campaigns.data?.items ?? [], [campaigns.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((c) => {
      const okSt = statusFilter === "ALL" || c.status === statusFilter;
      const okQ = !q || c.name.toLowerCase().includes(q);
      return okSt && okQ;
    });
  }, [allItems, statusFilter, search]);

  const counts = {
    all: allItems.length,
    active: allItems.filter((c) => c.status === "ACTIVE").length,
    paused: allItems.filter((c) => c.status === "PAUSED").length,
    draft: allItems.filter((c) => c.status === "DRAFT").length,
  };

  const [pageError, setPageError] = useState<string | null>(null);

  // Riwayat sub-view (owner request 2026-11-19: full page, no popup).
  const [runsFor, setRunsFor] = useState<CampaignRow | null>(null);

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

  function openRuns(c: CampaignRow) {
    setRunsFor(c);
  }

  // ── Riwayat sub-view ──
  if (runsFor) {
    return (
      <DashboardShell title={`Riwayat - ${runsFor.name}`}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <button
                type="button"
                onClick={() => setRunsFor(null)}
                className="inline-flex items-center gap-1 hover:text-slate-800"
              >
                <ArrowLeft size={13} /> Kampanye
              </button>
              <span>/</span>
              <span>Riwayat Kirim</span>
            </div>
            <h1 className="mt-1 text-xl font-bold text-slate-900">Riwayat - {runsFor.name}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Log lengkap setiap eksekusi pengiriman kampanye beserta status per nomor tujuan.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRunsFor(null)}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft size={15} /> Kembali ke Daftar
          </button>
        </div>
        <CampaignRunsView
          campaignId={runsFor.id}
          campaignName={runsFor.name}
          subtitle={`${audienceLabel(runsFor)} - ${scheduleLabel(runsFor)}`}
          onBack={() => setRunsFor(null)}
        />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Kampanye"
      description="Kirim pesan promosi ke banyak kontak sekaligus, dengan jadwal dan tempo yang terkontrol."
      actions={
        canManage ? (
          <Button onClick={() => router.push("/dashboard/campaigns/baru")} className="bg-green-600 hover:bg-green-700">
            Kampanye Baru
          </Button>
        ) : undefined
      }
    >
      {!canManage && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800">
          <span className="mt-0.5 shrink-0 text-base text-amber-600">!</span>
          <div>
            <p className="font-semibold">Akses Terbatas (Mode Staf)</p>
            <p className="mt-0.5 text-amber-700">
              Anda tidak memiliki izin mengelola kampanye. Minta owner mengaktifkan{" "}
              <strong>&quot;Boleh jalankan kampanye&quot;</strong> di halaman Tim.
            </p>
          </div>
        </div>
      )}
      {pageError && <p className="mb-4 text-sm text-destructive">{pageError}</p>}

      {/* Summary metrics (template redesign) */}
      {!campaigns.loading && !campaigns.error && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">Total Kampanye</p>
              <Megaphone size={16} className="text-slate-400" />
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
              {counts.all}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">Sedang Aktif</p>
              <span className="h-2 w-2 rounded-full bg-green-600" />
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-green-700">
              {campaigns.data?.stats?.active ?? counts.active}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">Terkirim Bulan Ini</p>
              <PaperPlaneTilt size={16} className="text-slate-400" />
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
              {campaigns.data?.stats?.sentThisMonth ?? 0}
            </p>
          </div>
        </div>
      )}

      {/* Status filter tabs + search */}
      {!campaigns.loading && (
        <div className="mb-4 flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs sm:flex-row sm:items-center">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 text-xs font-medium">
            {(
              [
                ["ALL", "Semua", counts.all],
                ["ACTIVE", "Aktif", counts.active],
                ["PAUSED", "Dijeda", counts.paused],
                ["DRAFT", "Draf", counts.draft],
              ] as const
            ).map(([k, l, n]) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                className={cn(
                  "rounded-md px-3 py-1.5",
                  statusFilter === k
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {l}{" "}
                <span className={cn("ml-1 tabular-nums", statusFilter === k ? "text-slate-400" : "text-slate-400")}>
                  {n}
                </span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama kampanye..."
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
            />
          </div>
        </div>
      )}

      <CampaignTable
        items={filtered}
        loading={campaigns.loading}
        error={campaigns.error}
        canManage={canManage}
        channelLabels={channelLabels}
        onRuns={openRuns}
        onEdit={(c) => router.push(`/dashboard/campaigns/${c.id}`)}
        onActivate={onActivate}
        onPause={onPause}
        onDelete={setToDelete}
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
