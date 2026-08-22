// Left pane of the CRM inbox: search + Assigned/Unassigned tabs + the
// conversation list. Presentational — the page owns the fetch/URL state and
// passes items + the selected id. Matches the reference's conversation list.
import type { ChangeEvent, FormEvent } from "react";
import { MagnifyingGlass, Faders, Plus, WhatsappLogo } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { ConversationListItem } from "@/types/inbox";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { EmptyState } from "@/components/dashboard/empty-state";

type Tab = "assigned" | "unassigned";

type ConversationListProps = {
  items: ConversationListItem[];
  loading: boolean;
  error: string | null;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  totals: { assigned: number; unassigned: number };
  /** Hide the list on mobile (a chat is open). Always visible on lg+. */
  mobileHidden?: boolean;
};

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function ConversationList({
  items,
  loading,
  error,
  tab,
  onTabChange,
  search,
  onSearchChange,
  selectedId,
  onSelect,
  totals,
  mobileHidden,
}: ConversationListProps) {
  function submitSearch(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col border-r border-slate-200 bg-white",
        mobileHidden ? "hidden w-80 lg:flex" : "w-full lg:w-80"
      )}
    >
      {/* Filters */}
      <div className="border-b border-slate-100 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Percakapan</span>
          <div className="flex gap-2 text-slate-400">
            <button className="hover:text-slate-600" aria-label="Filter">
              <Faders size={18} />
            </button>
            <button className="hover:text-slate-600" aria-label="Baru">
              <Plus size={18} />
            </button>
          </div>
        </div>

        <form onSubmit={submitSearch} className="relative mb-3">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
            placeholder="Cari nomor pelanggan…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm placeholder-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </form>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => onTabChange("assigned")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "assigned"
                ? "bg-white text-green-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            Ditugaskan
            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
              {totals.assigned}
            </span>
          </button>
          <button
            onClick={() => onTabChange("unassigned")}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "unassigned"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            Belum ditugaskan
          </button>
        </div>
      </div>

      {/* List */}
      <div className="scrollbar-slim flex-1 min-h-0 overflow-y-auto">
        {loading && <LoadingSkeleton rows={5} className="p-3" />}
        {error && (
          <div className="p-4 text-sm text-red-600">{error}</div>
        )}
        {!loading && !error && items.length === 0 && (
          <EmptyState
            className="h-full"
            title="Tidak ada percakapan"
            description="Percakapan pelanggan via WhatsApp akan muncul di sini."
          />
        )}
        {!loading &&
          !error &&
          items.map((c) => {
            const name = c.contact?.name ?? c.customerPhoneDisplay;
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-slate-50 p-4 text-left transition-colors",
                  active
                    ? "border-l-4 border-l-green-500 bg-green-50/50"
                    : "hover:bg-slate-50"
                )}
              >
                <div className="relative shrink-0">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                    {initials(name)}
                  </div>
                  <div className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-green-500 text-white">
                    <WhatsappLogo size={11} weight="fill" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline justify-between">
                    <h4 className="truncate text-sm font-semibold text-slate-900">{name}</h4>
                    <span className="ml-2 shrink-0 text-xs text-slate-400">
                      {timeLabel(c.lastMessageAt)}
                    </span>
                  </div>
                  {c.lastMessage && (
                    <p className="truncate text-xs text-slate-400">
                      {c.lastMessage.senderType === "AGENT"
                        ? "AI: "
                        : c.lastMessage.senderType === "HUMAN"
                          ? "Anda: "
                          : c.lastMessage.senderType === "SCENARIO"
                            ? "Skenario: "
                            : ""}
                      {c.lastMessage.body}
                    </p>
                  )}
                  {c.assignee && (
                    <p className="text-xs text-slate-500">Ditugaskan ke {c.assignee.name ?? c.assignee.email}</p>
                  )}
                  {c.assignedAgent && !c.assignee && (
                    <p className="text-xs text-blue-600">AI: {c.assignedAgent.name}</p>
                  )}
                  {c.status === "RESOLVED" && (
                    <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      Selesai
                    </span>
                  )}
                  {c.stage && (
                    <span className="mt-1 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                      {c.stage.name}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}
