// Left pane of the CRM inbox: search + Assigned/Unassigned tabs + the
// conversation list. Presentational - the page owns the fetch/URL state and
// passes items + the selected id. Matches the reference's conversation list.
//
// The row is memoized with a CONTENT comparator: the list polls every 8s and
// every refresh produces fresh object references, so a shallow memo would
// never fire. updatedAt is the server-side catch-all (any change that
// affects the row bumps it); unreadCount and the selection flag are the two
// client-side overlays. CONTRACT: any field added to the row's rendering
// must join rowsEqual, or it renders stale until a compared field changes.
import { memo } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { MagnifyingGlass, Faders, Plus, WhatsappLogo } from "@phosphor-icons/react";
import { cn } from "@csq/ui/lib/utils";
import type { ConversationListItem } from "@csq/core/types/inbox";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  hasFeature,
  useEntitlements,
} from "@/components/dashboard/entitlements-context";

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

type ConversationRowProps = {
  conversation: ConversationListItem;
  active: boolean;
  onSelect: (id: string) => void;
};

function rowsEqual(a: ConversationRowProps, b: ConversationRowProps): boolean {
  return (
    a.active === b.active &&
    a.conversation.updatedAt === b.conversation.updatedAt &&
    a.conversation.unreadCount === b.conversation.unreadCount &&
    a.conversation.channel.provider === b.conversation.channel.provider
  );
}

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

const ConversationRow = memo(function ConversationRow({
  conversation: c,
  active,
  onSelect,
}: ConversationRowProps) {
  const entitlements = useEntitlements();
  const name = c.contact?.name ?? c.customerPhoneDisplay;
  return (
    <button
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
      <div className="relative min-w-0 flex-1 pr-8">
        <div className="mb-1 flex items-baseline justify-between">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <h4 className="truncate text-sm font-semibold text-slate-900">{name}</h4>
            {/* FEA-6 (PRD 16): channel provider - Cloud API (official) vs
                Baileys (personal number). */}
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                c.channel.provider === "CLOUD_API"
                  ? "bg-blue-50 text-blue-700"
                  : "bg-slate-100 text-slate-600"
              )}
            >
              {c.channel.provider === "CLOUD_API" ? "Resmi" : "Pribadi"}
            </span>
          </div>
          <span className="ml-2 shrink-0 text-xs text-slate-400">
            {timeLabel(c.lastMessageAt)}
          </span>
        </div>
        {c.lastMessage && (
          <p className={cn(
            "truncate text-xs",
            c.unreadCount > 0 ? "font-medium text-slate-700" : "text-slate-400"
          )}>
            {c.lastMessage.senderType === "AGENT"
              ? "AI: "
              : c.lastMessage.senderType === "HUMAN"
                ? "Anda: "
                : c.lastMessage.senderType === "SCENARIO"
                  ? "Skenario: "
                  : c.lastMessage.senderType === "CAMPAIGN"
                    ? "Kampanye: "
                    : ""}
            {c.lastMessage.body ||
              (c.lastMessage.kind === "MEDIA" ? "[Gambar]" : "")}
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
        {hasFeature(entitlements, "pipeline") && c.stage && (
          <span className="mt-1 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
            {c.stage.name}
          </span>
        )}
        {c.unreadCount > 0 && (
          <span className="absolute right-0 top-1/2 -translate-y-1/2 flex h-5 min-w-5 items-center justify-center rounded-full bg-green-500 px-1 text-[11px] font-semibold text-white">
            {c.unreadCount > 99 ? "99+" : c.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}, rowsEqual);

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
          items.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              active={c.id === selectedId}
              onSelect={onSelect}
            />
          ))}
      </div>
    </div>
  );
}
