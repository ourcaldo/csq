import { useEffect, useRef, useState } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { CheckCircle, Plus } from "@phosphor-icons/react";
import { withFeature } from "@csq/core/lib/auth";
import { apiFetch, apiSend, ApiError } from "@/lib/api-client";
import { usePolledApi } from "@/hooks/use-polled-api";
import type { Stage, StageKind, Tag } from "@csq/core/types/inbox";
import type { PipelineBoardResult, PipelineDeal } from "@csq/core/types/pipeline";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { Button } from "@csq/ui/components/ui/button";
import { Select } from "@csq/ui/components/ui/select";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { StateNotice } from "@/components/dashboard/state-notice";
import { StageManager } from "@/components/dashboard/pipeline/stage-manager";
import { LeadDrawer } from "@/components/dashboard/pipeline/lead-drawer";
import {
  formatRupiah,
  initialOf,
  timeAgo,
} from "@/components/dashboard/pipeline/format";

// Manajemen Pipeline (revamp 2026-11-16, reference
// docs/assets/csq_pipeline_management_revamp.html). Kanban columns per stage
// with rich lead cards (last message, unread, tag, value, PIC), a slide-over
// detail drawer with quick reply, manual lead entry, and the funnel view.
//
// Cards are Draggable (HTML5 DnD): dropping on a column moves the deal. A click
// opens the drawer - the mousedown position is compared with the click so a
// drag that ends on the card does not open it.

type ColumnState = {
  stageId: string;
  items: PipelineDeal[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
};

type FunnelStage = {
  stageId: string;
  name: string;
  order: number;
  kind: StageKind;
  count: number;
};

const COLUMN_PAGE_SIZE = 30;

const STAGE_DOT: Record<StageKind, string> = {
  OPENING: "bg-blue-500",
  NORMAL: "bg-amber-500",
  WON: "bg-emerald-500",
  LOST: "bg-rose-500",
};

function previewText(deal: PipelineDeal): string | null {
  const last = deal.conversation.lastMessage;
  if (!last) return null;
  if (last.body.trim()) return last.body;
  return last.kind === "MEDIA" ? "[Gambar]" : null;
}

export default function PipelinePage() {
  const router = useRouter();
  const [view, setView] = useState<"kanban" | "funnel">("kanban");
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [columns, setColumns] = useState<ColumnState[]>([]);
  const [funnel, setFunnel] = useState<FunnelStage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [activeDeal, setActiveDeal] = useState<PipelineDeal | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dragConversationId, setDragConversationId] = useState<string | null>(null);

  // Filters.
  const [assignee, setAssignee] = useState("");
  const [tag, setTag] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [team, setTeam] = useState<{ id: string; name: string }[] | null>(null);
  const [tags, setTags] = useState<Tag[] | null>(null);

  // Tambah Lead dialog.
  const [leadPhone, setLeadPhone] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadStage, setLeadStage] = useState("");
  const [leadValue, setLeadValue] = useState("0");
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);

  // PRD 28 Part B: silent 8s poll - stage moves, deal changes, and new leads
  // appear without a manual reload (no skeleton flash on refreshes).
  const pipelineApi = usePolledApi<{ stages: Stage[] }>("/api/dashboard/pipeline", 8000);

  useEffect(() => {
    if (pipelineApi.data) setStages(pipelineApi.data.stages);
  }, [pipelineApi.data]);

  // Toast auto-hide.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Team + tags for the filters (once).
  useEffect(() => {
    void (async () => {
      try {
        const teamRes = await apiFetch<{
          items: { id: string; name: string | null; email: string }[];
        }>("/api/dashboard/team?pageSize=100");
        setTeam(teamRes.items.map((u) => ({ id: u.id, name: u.name ?? u.email })));
      } catch {
        setTeam([]);
      }
      try {
        const tagRes = await apiFetch<{ items: Tag[] }>(
          "/api/dashboard/tags?pageSize=200"
        );
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

  async function loadColumn(stageId: string, page: number, replace: boolean) {
    setColumns((prev) =>
      prev.map((c) => (c.stageId === stageId ? { ...c, loading: true } : c))
    );
    const fq = filterQuery();
    try {
      const res = await apiFetch<PipelineBoardResult>(
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
  }, [stages, assignee, tag, from, to]);

  function refreshBoard() {
    if (!stages) return;
    for (const s of stages) void loadColumn(s.id, 1, true);
  }

  async function moveStage(conversationId: string, stageName: string) {
    setError(null);
    try {
      await apiSend(`/api/dashboard/pipeline/deals/${conversationId}`, "PATCH", {
        stage: stageName,
      });
      setToast(`Dipindahkan ke tahap "${stageName}"`);
      refreshBoard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memindahkan deal.");
    }
  }

  // Funnel counts.
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

  function openChat(conversationId: string) {
    void router.push({
      pathname: "/dashboard/inbox",
      query: { c: conversationId },
    });
    setActiveDeal(null);
  }
  function openContact(phone: string) {
    void router.push({
      pathname: "/dashboard/contacts",
      query: phone ? { search: phone } : {},
    });
    setActiveDeal(null);
  }

  function openAddLead() {
    const first = (stages ?? []).find(
      (s) => s.kind !== "WON" && s.kind !== "LOST"
    );
    setLeadPhone("");
    setLeadName("");
    setLeadStage(first?.name ?? "");
    setLeadValue("0");
    setLeadError(null);
    setAddOpen(true);
  }

  async function submitLead() {
    if (!leadPhone.trim()) {
      setLeadError("Nomor WhatsApp wajib diisi.");
      return;
    }
    if (!leadStage) {
      setLeadError("Pilih tahap awal.");
      return;
    }
    setLeadBusy(true);
    setLeadError(null);
    try {
      const res = await apiSend<{ created: boolean }>(
        "/api/dashboard/pipeline/deals",
        "POST",
        {
          phone: leadPhone.trim(),
          ...(leadName.trim() ? { name: leadName.trim() } : {}),
          stage: leadStage,
          value: Number(leadValue) || 0,
        }
      );
      setAddOpen(false);
      setToast(
        res.created
          ? "Lead ditambahkan ke pipeline"
          : "Lead sudah ada, pipeline diperbarui"
      );
      refreshBoard();
    } catch (err) {
      setLeadError(err instanceof ApiError ? err.message : "Gagal menambah lead.");
    } finally {
      setLeadBusy(false);
    }
  }

  const totalActive = columns.reduce((sum, c) => sum + c.total, 0);
  const maxFunnelCount = Math.max(1, ...(funnel ?? []).map((s) => s.count));

  return (
    <DashboardShell
      title="Manajemen Pipeline"
      description="Klik kartu untuk detail pelanggan dan balas cepat, atau geser kartu antar tahap."
      flush
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 md:p-6">
        {/* Page header (flush mode has no shell header, so the actions live
            here, same pattern as the inbox). */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              Manajemen Pipeline
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {totalActive} Pelanggan Aktif
              </span>
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Klik kartu untuk detail pelanggan dan balas cepat, atau geser
              kartu antar tahap.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
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
            <Button
              onClick={openAddLead}
              className="gap-1.5 bg-green-600 hover:bg-green-700"
            >
              <Plus size={16} weight="bold" />
              Tambah Lead
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="shrink-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="filter-assignee">Penanggung Jawab</Label>
                <Select
                  id="filter-assignee"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="w-44"
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
                  className="w-44"
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
                  className="w-36"
                />
              </div>
              <div>
                <Label htmlFor="filter-to">Sampai</Label>
                <Input
                  id="filter-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-36"
                />
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setAssignee("");
                  setTag("");
                  setFrom("");
                  setTo("");
                }}
              >
                Reset
              </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {view === "kanban" && (
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
            {pipelineApi.loading && !stages && (
              <StateNotice variant="loading" message="Memuat pipeline…" />
            )}
            {(stages ?? []).map((s) => {
              const col = columns.find((c) => c.stageId === s.id);
              const items = col?.items ?? [];
              const hasMore = col ? col.items.length < col.total : false;
              return (
                <div
                  key={s.id}
                  className="flex w-72 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-100/70 sm:w-80"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragConversationId) {
                      void moveStage(dragConversationId, s.name);
                      setDragConversationId(null);
                    }
                  }}
                >
                  <div className="shrink-0 rounded-t-xl border-b border-slate-200/70 bg-white/60 px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "h-2.5 w-2.5 rounded-full " + STAGE_DOT[s.kind]
                          }
                        />
                        <span className="text-sm font-bold text-slate-800">
                          {s.name}
                        </span>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-bold text-slate-700">
                        {col?.total ?? 0}
                      </span>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
                    {col?.loading && items.length === 0 && (
                      <p className="px-1 py-2 text-xs text-slate-400">Memuat…</p>
                    )}
                    {!col?.loading && items.length === 0 && (
                      <div className="flex h-28 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 text-center">
                        <p className="text-xs font-medium text-slate-400">
                          Tidak ada deal.
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Geser kartu ke sini
                        </p>
                      </div>
                    )}
                    {items.map((d) => {
                      const preview = previewText(d);
                      const contactName = d.conversation.contact?.name;
                      const assigneeName =
                        d.conversation.assignee?.name ??
                        d.conversation.assignee?.email ??
                        null;
                      return (
                        <div
                          key={d.id}
                          draggable
                          onDragStart={() => setDragConversationId(d.conversationId)}
                          onDragEnd={() => setDragConversationId(null)}
                          onMouseDown={(e) =>
                            (dragStart.current = { x: e.clientX, y: e.clientY })
                          }
                          onClick={(e) => {
                            const start = dragStart.current;
                            if (
                              start &&
                              (Math.abs(e.clientX - start.x) > 5 ||
                                Math.abs(e.clientY - start.y) > 5)
                            ) {
                              return;
                            }
                            setActiveDeal(d);
                          }}
                          className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-green-400 hover:shadow-md"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {/* Name-first (owner request 2026-11-22): the
                                    top line is the contact / WhatsApp name,
                                    the number only when no name exists. */}
                                <span className="truncate text-sm font-bold text-slate-900 group-hover:text-green-700">
                                  {contactName ?? d.conversation.customerPhoneDisplay}
                                </span>
                                {d.unreadCount > 0 && (
                                  <span className="rounded-full bg-green-600 px-1.5 text-[10px] font-bold text-white">
                                    {d.unreadCount}
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-xs text-slate-500">
                                {contactName
                                  ? d.conversation.customerPhoneDisplay +
                                    (d.conversation.contact?.email
                                      ? ` - ${d.conversation.contact.email}`
                                      : "")
                                  : d.conversation.contact?.source ?? "Pelanggan baru"}
                              </p>
                            </div>
                            <span className="whitespace-nowrap text-[11px] text-slate-400">
                              {timeAgo(d.conversation.lastMessageAt)}
                            </span>
                          </div>

                          {preview && (
                            <div className="my-2.5 rounded-lg border border-slate-100 bg-slate-50 p-2">
                              <p className="line-clamp-2 text-xs leading-relaxed text-slate-600">
                                {preview}
                              </p>
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                            <span className="truncate rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {d.conversation.tags[0]?.tag.name ?? "Tanpa tag"}
                            </span>
                            {d.value > 0 && (
                              <span className="shrink-0 text-xs font-bold text-green-700">
                                {formatRupiah(d.value)}
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2 text-[11px] text-slate-500">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-100 text-[9px] font-bold text-green-700">
                                {assigneeName ? initialOf(assigneeName) : "?"}
                              </span>
                              <span className="truncate">
                                {assigneeName ?? "Belum ditugaskan"}
                              </span>
                            </span>
                            <span className="shrink-0 font-semibold text-green-600 opacity-0 transition group-hover:opacity-100">
                              Detail
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {hasMore && (
                      <button
                        onClick={() =>
                          col && void loadColumn(s.id, (col.page ?? 1) + 1, false)
                        }
                        disabled={col?.loading}
                        className="w-full rounded-md py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                      >
                        Muat lainnya
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
                      <span className="w-28 shrink-0 text-sm font-medium">
                        {s.name}
                      </span>
                      <div className="h-7 flex-1 overflow-hidden rounded-md bg-slate-100">
                        <div
                          className="h-full rounded-md bg-slate-900"
                          style={{ width: `${(s.count / maxFunnelCount) * 100}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs text-slate-600">
                        {s.count}
                        {rate != null && (
                          <span className="text-slate-400"> - {rate}%</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {activeDeal && (
        <LeadDrawer
          key={activeDeal.id}
          deal={activeDeal}
          stages={stages ?? []}
          onClose={() => setActiveDeal(null)}
          onChanged={refreshBoard}
          onOpenChat={openChat}
          onOpenContact={openContact}
          onToast={setToast}
        />
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Tambah Pelanggan ke Pipeline"
        description="Masukkan nomor WhatsApp. Pelanggan yang sudah ada akan diperbarui, bukan diduplikasi."
      >
        <div className="space-y-3.5">
          <div>
            <Label htmlFor="lead-phone">Nomor WhatsApp</Label>
            <Input
              id="lead-phone"
              value={leadPhone}
              onChange={(e) => setLeadPhone(e.target.value)}
              placeholder="Contoh: 081234567890"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="lead-name">Nama Pelanggan (opsional)</Label>
            <Input
              id="lead-name"
              value={leadName}
              onChange={(e) => setLeadName(e.target.value)}
              placeholder="Contoh: Budi Santoso"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lead-stage">Tahap Awal</Label>
              <Select
                id="lead-stage"
                value={leadStage}
                onChange={(e) => setLeadStage(e.target.value)}
              >
                {(stages ?? [])
                  .filter((s) => s.kind !== "WON" && s.kind !== "LOST")
                  .map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lead-value">Estimasi Nilai (Rp)</Label>
              <Input
                id="lead-value"
                type="number"
                min={0}
                step={1000}
                value={leadValue}
                onChange={(e) => setLeadValue(e.target.value)}
              />
            </div>
          </div>
          {leadError && <p className="text-sm text-red-600">{leadError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={() => void submitLead()}
              disabled={leadBusy}
              className="bg-green-600 hover:bg-green-700"
            >
              {leadBusy ? "Menyimpan…" : "Simpan Lead"}
            </Button>
          </div>
        </div>
      </Dialog>

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

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 animate-in items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg fade-in">
          <CheckCircle size={14} weight="fill" className="text-green-400" />
          {toast}
        </div>
      )}
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withFeature(
  "pipeline",
  async () => ({ props: {} })
);
