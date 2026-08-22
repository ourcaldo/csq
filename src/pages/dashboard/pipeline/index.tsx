import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@/lib/auth";
import { apiFetch, apiSend, ApiError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@/types/dashboard";
import type { Stage, Tag } from "@/types/inbox";
import { DealWithRelations } from "@/lib/pipeline";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StateNotice } from "@/components/dashboard/state-notice";
import { StageManager } from "@/components/dashboard/pipeline/stage-manager";

// Manajemen Pipeline — kanban + funnel views of every conversation's deal stage.
// Kanban: columns = stages, cards = deals, drag a card to move stage. Funnel:
// per-stage counts + conversion rates. Filters by assignee + tag + date range.
// "Atur Tahap" opens the stage customization dialog.
//
// A KanbanDeal is the Prisma Deal shape (id = DEAL id, conversationId = the chat,
// contact/assignee nested under `conversation`). The move PATCH uses
// `conversationId` (the chat id), not `id` (the deal id) — see bug #3.

type KanbanDeal = DealWithRelations;

type ColumnState = {
  stageId: string;
  items: KanbanDeal[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
};

type FunnelStage = {
  stageId: string;
  name: string;
  order: number;
  kind: "OPENING" | "WON" | "LOST" | "NORMAL";
  count: number;
};

const COLUMN_PAGE_SIZE = 30;

export default function PipelinePage() {
  const [view, setView] = useState<"kanban" | "funnel">("kanban");
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [columns, setColumns] = useState<ColumnState[]>([]);
  const [funnel, setFunnel] = useState<FunnelStage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  // Filters.
  const [assignee, setAssignee] = useState("");
  const [tag, setTag] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [team, setTeam] = useState<{ id: string; name: string }[] | null>(null);
  const [tags, setTags] = useState<Tag[] | null>(null);

  // The dragged deal (HTML5 DnD) — the conversation id being moved.
  const [dragConversationId, setDragConversationId] = useState<string | null>(null);

  const pipelineApi = useApi<{ stages: Stage[] }>("/api/dashboard/pipeline");

  useEffect(() => {
    if (pipelineApi.data) setStages(pipelineApi.data.stages);
  }, [pipelineApi.data]);

  // Load team + tags for the filter selects once.
  useEffect(() => {
    void (async () => {
      try {
        const teamRes = await apiFetch<
          ListResult<{ id: string; name: string | null; email: string }>
        >("/api/dashboard/team?pageSize=100");
        setTeam(teamRes.items.map((u) => ({ id: u.id, name: u.name ?? u.email })));
      } catch {
        setTeam([]);
      }
      try {
        const tagRes = await apiFetch<{ items: Tag[] }>("/api/dashboard/tags?pageSize=200");
        setTags(tagRes.items);
      } catch {
        setTags([]);
      }
    })();
  }, []);

  const filterQuery = () => {
    const params = new URLSearchParams();
    if (assignee) params.set("assignee", assignee);
    if (tag) params.set("tag", tag);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  };

  // Load deals per stage (kanban) whenever stages or filters change.
  async function loadColumn(stageId: string, page: number, replace: boolean) {
    setColumns((prev) =>
      prev.map((c) => (c.stageId === stageId ? { ...c, loading: true } : c))
    );
    const fq = filterQuery();
    try {
      const res = await apiFetch<ListResult<KanbanDeal>>(
        `/api/dashboard/pipeline/deals?stage=${stageId}${fq ? `&${fq}` : ""}&page=${page}&pageSize=${COLUMN_PAGE_SIZE}`
      );
      setColumns((prev) =>
        prev.map((c) =>
          c.stageId === stageId
            ? {
                ...c,
                items: replace ? res.items : [...c.items, ...res.items],
                page: res.page,
                pageSize: res.pageSize,
                total: res.total,
                loading: false,
              }
            : c
        )
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat deal.");
      setColumns((prev) =>
        prev.map((c) => (c.stageId === stageId ? { ...c, loading: false } : c))
      );
    }
  }

  useEffect(() => {
    if (!stages) return;
    setColumns(
      stages.map((s) => ({
        stageId: s.id,
        items: [],
        page: 1,
        pageSize: COLUMN_PAGE_SIZE,
        total: 0,
        loading: true,
      }))
    );
    for (const s of stages) void loadColumn(s.id, 1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages, assignee, tag]);

  // Load funnel counts whenever filters change.
  async function loadFunnel() {
    try {
      const res = await apiFetch<FunnelStage[]>("/api/dashboard/pipeline/funnel");
      setFunnel(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat funnel.");
    }
  }
  useEffect(() => {
    if (view === "funnel") void loadFunnel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, assignee, tag]);

  async function moveStage(conversationId: string, stageName: string) {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/pipeline/deals/${conversationId}`, "PATCH", { stage: stageName });
      // Reload the affected columns (source + destination).
      const fromCol = columns.find((c) =>
        c.items.some((d) => d.conversationId === conversationId)
      );
      const toCol = columns.find((c) => c.stageId === (stages?.find((s) => s.name === stageName)?.id ?? ""));
      if (fromCol) void loadColumn(fromCol.stageId, 1, true);
      if (toCol) void loadColumn(toCol.stageId, 1, true);
      pipelineApi.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memindahkan deal.");
    } finally {
      setBusy(false);
    }
  }

  const maxFunnelCount = Math.max(1, ...(funnel ?? []).map((s) => s.count));

  return (
    <DashboardShell
      title="Manajemen Pipeline"
      description="Pantau setiap pelanggan di tahap mana dan pindahkan sesuai alur."
      flush
      actions={
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 p-0.5">
            <button
              onClick={() => setView("kanban")}
              className={
                "rounded px-2.5 py-1 text-xs font-medium " +
                (view === "kanban" ? "bg-slate-900 text-white" : "text-slate-600")
              }
            >
              Kanban
            </button>
            <button
              onClick={() => setView("funnel")}
              className={
                "rounded px-2.5 py-1 text-xs font-medium " +
                (view === "funnel" ? "bg-slate-900 text-white" : "text-slate-600")
              }
            >
              Funnel
            </button>
          </div>
          <Button variant="outline" onClick={() => setManageOpen(true)}>
            Atur Tahap
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6 gap-4">
      {/* Filters */}
      <div className="shrink-0 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="filter-assignee">Penanggung Jawab</Label>
          <Select
            id="filter-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            disabled={busy}
            className="w-48"
          >
            <option value="">Semua</option>
            {(team ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="filter-tag">Tag</Label>
          <Select
            id="filter-tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            disabled={busy}
            className="w-48"
          >
            <option value="">Semua</option>
            {(tags ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="filter-from">Dari</Label>
          <Input
            id="filter-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={busy}
            className="w-40"
          />
        </div>
        <div>
          <Label htmlFor="filter-to">Sampai</Label>
          <Input
            id="filter-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={busy}
            className="w-40"
          />
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {view === "kanban" && (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
          {pipelineApi.loading && !stages && <StateNotice variant="loading" message="Memuat pipeline…" />}
          {(stages ?? []).map((s, idx) => {
            const col = columns.find((c) => c.stageId === s.id);
            const items = col?.items ?? [];
            const hasMore = col ? col.items.length < col.total : false;
            return (
              <div
                key={s.id}
                className="flex w-72 shrink-0 flex-col rounded-lg border bg-slate-50/60"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragConversationId) {
                    void moveStage(dragConversationId, s.name);
                    setDragConversationId(null);
                  }
                }}
              >
                <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <Badge variant="outline">{col?.total ?? 0}</Badge>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {col?.loading && items.length === 0 && (
                    <p className="px-1 py-2 text-xs text-slate-400">Memuat…</p>
                  )}
                  {!col?.loading && items.length === 0 && (
                    <p className="px-1 py-2 text-xs text-slate-400">Tidak ada deal.</p>
                  )}
                  {items.map((d) => (
                    <div
                      key={d.id}
                      draggable
                      onDragStart={() => setDragConversationId(d.conversationId)}
                      className="cursor-grab rounded-md border bg-white p-2.5 shadow-sm active:cursor-grabbing"
                    >
                      <p className="text-sm font-medium">
                        {d.conversation?.contact?.name ?? d.conversation?.customerPhone ?? ""}
                      </p>
                      {d.conversation?.assignee && (
                        <p className="mt-1 text-[10px] text-slate-400">
                          {d.conversation.assignee.name ?? d.conversation.assignee.email}
                        </p>
                      )}
                    </div>
                  ))}
                  {hasMore && (
                    <button
                      onClick={() => col && void loadColumn(s.id, (col.page ?? 1) + 1, false)}
                      disabled={col?.loading}
                      className="w-full rounded-md py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      Muat lainya
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "funnel" && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-white p-6">
          {!funnel && <StateNotice variant="loading" message="Memuat funnel…" />}
          {funnel && funnel.length === 0 && (
            <StateNotice variant="empty" message="Belum ada deal di pipeline." />
          )}
          {funnel && funnel.length > 0 && (
            <div className="space-y-3">
              {funnel.map((s) => {
                const prev = funnel[s.order - 2];
                const rate =
                  prev && prev.count > 0
                    ? Math.round((s.count / prev.count) * 100)
                    : null;
                return (
                  <div key={s.stageId} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-sm font-medium">{s.name}</span>
                    <div className="h-7 flex-1 overflow-hidden rounded-md bg-slate-100">
                      <div
                        className="h-full rounded-md bg-slate-900"
                        style={{ width: `${(s.count / maxFunnelCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-slate-600">
                      {s.count}
                      {rate != null && <span className="text-slate-400"> · {rate}%</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <StageManager
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={() => {
          pipelineApi.refresh();
          if (view === "funnel") void loadFunnel();
          setColumns(
            (stages ?? []).map((s) => ({
              stageId: s.id,
              items: [],
              page: 1,
              pageSize: COLUMN_PAGE_SIZE,
              total: 0,
              loading: true,
            }))
          );
        }}
      />
      </div>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
