// Tiket page (FEA-3, PRD 16). Redesign 2026-11-19 (docs/demo/
// tiket_csq_support_tickets.html): open-count badge, staff read-only
// notice, 3 metric cards, status filter tabs + search, unified ticket
// table with pagination, slide-over detail drawer with report body,
// customer phone copy, agent/resolver info, and owner-only resolve.
import { useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import {
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  Check,
  CheckCircle,
  Copy,
  Lifebuoy,
  LockSimple,
  MagnifyingGlass,
  Robot,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend, ApiError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult, SupportTicket } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { cn } from "@csq/ui/lib/utils";

const PAGE_SIZE = 20;

type TicketRow = SupportTicket & {
  createdByAgentName: string | null;
  resolvedByName: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "-";
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

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

export default function TicketsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const canManage = !!session?.user?.isOwner || !!session?.user?.permissions?.includes("tiket.kelola");

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("ALL");
  const [search, setSearch] = useState("");
  const [closingId, setClosingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  const url = `/api/dashboard/tickets?page=${page}&pageSize=${PAGE_SIZE}`;
  const { data, loading, error, refresh } = useApi<ListResult<TicketRow>>(url);
  const tickets = useMemo(() => data?.items ?? [], [data]);

  // Status + search filter client-side over the current page (server
  // pagination is by createdAt only).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      const okSt = statusFilter === "ALL" || t.status === statusFilter;
      const okQ =
        !q ||
        t.subject.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        (t.contactPhone ?? "").toLowerCase().includes(q);
      return okSt && okQ;
    });
  }, [tickets, statusFilter, search]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const detail = detailId ? tickets.find((t) => t.id === detailId) ?? null : null;

  function copyPhone(phone: string) {
    void navigator.clipboard.writeText(phone);
    showToast(`Nomor +${phone} disalin`);
  }

  async function closeTicket(t: TicketRow) {
    if (closingId) return;
    setClosingId(t.id);
    setPageError(null);
    try {
      await apiSend<SupportTicket>(`/api/dashboard/tickets/${t.id}`, "POST");
      showToast(`Tiket #${t.id.slice(0, 8).toUpperCase()} ditandai selesai`);
      refresh();
    } catch (e) {
      setPageError(errMsg(e, "Gagal menutup tiket."));
    } finally {
      setClosingId(null);
    }
  }

  return (
    <DashboardShell
      title="Tiket"
      description="Eskalasi dan tiket dukungan yang dibuat otomatis oleh agen AI dari percakapan pelanggan."
    >
      {pageError && (
        <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-600">
          {pageError}
        </p>
      )}
      {error && (
        <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
      {loading && <LoadingSkeleton rows={4} />}

      {/* Staff read-only notice */}
      {!loading && !canManage && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-600 shadow-xs">
          <LockSimple size={16} weight="fill" className="mt-0.5 shrink-0 text-slate-400" />
          <div>
            <p className="font-semibold text-slate-800">Mode Pantau (Staf)</p>
            <p className="mt-0.5 text-slate-500">
              Anda dapat melihat rincian seluruh tiket pelanggan, namun hanya akun dengan peran{" "}
              <strong>Owner</strong> yang dapat menandai tiket selesai.
            </p>
          </div>
        </div>
      )}

      {!loading && (
        <>
          {/* Summary metrics strip */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Total Tiket"
              value={String(total)}
              icon={<Lifebuoy size={16} className="text-slate-400" />}
            />
            <StatCard
              label="Perlu Tindak Lanjut (Terbuka)"
              value={String(tickets.filter((t) => t.status === "OPEN").length)}
              valueCls="text-amber-600"
              icon={<span className="h-2 w-2 rounded-full bg-amber-500" />}
            />
            <StatCard
              label="Selesai Ditangani"
              value={String(tickets.filter((t) => t.status === "RESOLVED").length)}
              valueCls="text-green-700"
              icon={<span className="h-2 w-2 rounded-full bg-green-600" />}
            />
          </div>

          {/* Unified ticket table card */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Filter tabs & search toolbar */}
            <div className="flex flex-col justify-between gap-3 border-b border-slate-200 bg-slate-50/50 p-4 sm:flex-row sm:items-center">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-200/60 p-0.5 text-xs font-medium">
                {(
                  [
                    ["ALL", "Semua"],
                    ["OPEN", "Terbuka"],
                    ["RESOLVED", "Selesai"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => {
                      setStatusFilter(k);
                      setPage(1);
                    }}
                    className={cn(
                      "rounded-md px-3 py-1.5",
                      statusFilter === k
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:w-72">
                <MagnifyingGlass
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Cari subjek, isi, atau nomor HP..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Data table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Tiket &amp; Pelanggan</th>
                    <th className="hidden px-4 py-3 md:table-cell">Ringkasan Masalah</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Percakapan</th>
                    <th className="hidden px-4 py-3 sm:table-cell">Dibuat</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                          <Lifebuoy size={20} />
                        </div>
                        <p className="mt-3 text-sm font-semibold text-slate-900">Tidak ada tiket ditemukan</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Coba ubah filter status atau kata kunci pencarian.
                        </p>
                      </td>
                    </tr>
                  )}
                  {filtered.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setDetailId(t.id)}
                      className="cursor-pointer transition-colors hover:bg-slate-50/90"
                    >
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-medium uppercase text-slate-400">
                            #{t.id.slice(0, 8)}
                          </span>
                          <p className="font-semibold text-slate-900">{t.subject}</p>
                        </div>
                        <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
                          {t.contactPhone ? `+${t.contactPhone}` : "-"}
                        </p>
                      </td>
                      <td className="hidden max-w-xs truncate px-4 py-3.5 text-xs text-slate-600 md:table-cell">
                        {t.body}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="hidden px-4 py-3.5 lg:table-cell">
                        {t.conversationId ? (
                          <a
                            href={`/dashboard/inbox?c=${encodeURIComponent(t.conversationId)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 transition hover:bg-green-100"
                          >
                            <ChatCircleDots size={14} /> Lihat chat
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3.5 text-xs tabular-nums text-slate-500 sm:table-cell">
                        {formatDate(t.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailId(t.id);
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            Detail
                          </button>
                          {canManage && t.status === "OPEN" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void closeTicket(t);
                              }}
                              disabled={closingId === t.id}
                              className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-green-700 disabled:opacity-40"
                            >
                              <Check size={12} weight="bold" />
                              {closingId === t.id ? "Menutup..." : "Selesaikan"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            {total > 0 && (
              <div className="border-t border-slate-200 bg-slate-50/40 px-4">
                <div className="flex flex-col gap-3 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                  <span className="tabular-nums">
                    Menampilkan{" "}
                    <strong className="font-medium text-slate-800">
                      {(page - 1) * PAGE_SIZE + 1}
                      {" \u2013 "}
                      {Math.min(total, page * PAGE_SIZE)}
                    </strong>{" "}
                    dari <strong className="font-medium text-slate-800">{total}</strong> tiket
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <CaretLeft size={12} /> Sebelumnya
                    </button>
                    <span className="min-w-[6.5rem] text-center font-medium tabular-nums text-slate-700">
                      Hal. {page} / {totalPages}
                    </span>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                    >
                      Berikutnya <CaretRight size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══ Detail drawer ═══ */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/30"
          style={{ animation: "tktFadeIn 0.15s ease-out" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailId(null);
          }}
        >
          <style>{`@keyframes tktFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tktSlideIn { from { transform: translateX(24px) } to { transform: translateX(0) } }`}</style>
          <div
            className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl"
            style={{ animation: "tktSlideIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)" }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-600">
                  #{detail.id.slice(0, 8).toUpperCase()}
                </span>
                <StatusBadge status={detail.status} />
              </div>
              <button
                onClick={() => setDetailId(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{detail.subject}</h2>
                <p className="mt-1 text-xs text-slate-500">Dibuat pada {formatDate(detail.createdAt)}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Detail Laporan
                </p>
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{detail.body}</p>
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-2">
                <div>
                  <p className="text-slate-400">Nomor Pelanggan</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-slate-900">
                      {detail.contactPhone ? `+${detail.contactPhone}` : "-"}
                    </span>
                    {detail.contactPhone && (
                      <button
                        onClick={() => copyPhone(detail.contactPhone ?? "")}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title="Salin nomor"
                      >
                        <Copy size={13} />
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-slate-400">Dibuat Oleh Agent</p>
                  <p className="mt-1 flex items-center gap-1.5 font-medium text-slate-800">
                    <Robot size={14} className="text-slate-400" />{" "}
                    {detail.createdByAgentName ?? detail.createdByAgentId ?? "Sistem"}
                  </p>
                </div>
              </div>

              {detail.status === "RESOLVED" && (
                <div className="rounded-xl border border-green-200 bg-green-50/70 p-3.5 text-xs text-green-800">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle size={14} weight="fill" className="text-green-600" /> Tiket telah
                    diselesaikan
                  </p>
                  <p className="mt-1 text-green-700">
                    Ditutup oleh <strong>{detail.resolvedByName ?? "Owner"}</strong> pada{" "}
                    {formatDate(detail.resolvedAt)}.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
              {detail.conversationId ? (
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/dashboard/inbox?c=${encodeURIComponent(detail.conversationId ?? "")}`)
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <WhatsappLogo size={15} className="text-green-600" /> Buka Percakapan
                </button>
              ) : (
                <span className="text-xs text-slate-400">Tidak ada percakapan tertaut</span>
              )}
              {canManage && detail.status === "OPEN" ? (
                <button
                  type="button"
                  onClick={() => void closeTicket(detail)}
                  disabled={closingId === detail.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-green-700 disabled:opacity-50"
                >
                  <Check size={12} weight="bold" /> Tandai Selesai
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setDetailId(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Tutup
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg">
          <CheckCircle size={14} weight="fill" className="text-green-400" />
          {toast}
        </div>
      )}
    </DashboardShell>
  );
}

// ── Sub-components ──

function StatusBadge({ status }: { status: string }) {
  const resolved = status === "RESOLVED";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        resolved ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", resolved ? "bg-green-600" : "bg-amber-500")} />
      {resolved ? "Selesai" : "Terbuka"}
    </span>
  );
}

function StatCard(props: { label: string; value: string; valueCls?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{props.label}</p>
        {props.icon}
      </div>
      <p className={cn("mt-1.5 text-2xl font-bold tabular-nums text-slate-900", props.valueCls)}>
        {props.value}
      </p>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  // STAFF can read tickets (FEA-3); closing is OWNER-only in the API.
  async () => ({ props: {} })
);
