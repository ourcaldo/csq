// CRM Inbox - the flagship dashboard view. Three panes: conversation list,
// chat panel, and contact details. Full-bleed inside the shell (flush mode).
// Owner/staff see all tenant conversations; selecting one opens the chat.
// Handoff (take over / release) and tag/status actions live in the details pane.
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend, ApiError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { usePolledApi } from "@/hooks/use-polled-api";
import type { ListResult, Tag } from "@csq/core/types/dashboard";
import type { ConversationListItem } from "@csq/core/types/inbox";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useNotifications } from "@/components/dashboard/notifications/notifications-context";
import { ConversationList } from "@/components/dashboard/inbox/conversation-list";
import { ChatPanel } from "@/components/dashboard/inbox/chat-panel";
import { ContactDetails } from "@/components/dashboard/inbox/contact-details";
import { Select } from "@csq/ui/components/ui/select";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Button } from "@csq/ui/components/ui/button";

type Tab = "assigned" | "unassigned";

function isHumanAssigned(c: ConversationListItem): boolean {
  return !!c.assignee;
}

// Channel filter option shape (from /api/dashboard/channels).
type ChannelSummary = {
  id: string;
  label: string;
  provider: "CLOUD_API" | "BAILEYS";
  status: string;
  phoneNumber: string | null;
};

// Team member shape for the staff filter (from /api/dashboard/team).
type TeamMember = {
  id: string;
  email: string;
  name: string | null;
  isOwner: boolean;
};

type InboxPageProps = {
  apiMediaBase: string;
};

export default function InboxPage({ apiMediaBase }: InboxPageProps) {
  const router = useRouter();
  const { data: session } = useSession();
  // PRD 30: opening a chat clears its bell notification too.
  const { refresh: refreshNotifications } = useNotifications();
  const myUserId = session?.user?.id ?? null;
  // Assignment visibility (PRD 29): inbox.tugaskan holders see and work
  // every conversation; others only their own assigned ones.
  const isOwner =
    !!session?.user?.isOwner || !!session?.user?.permissions?.includes("inbox.tugaskan");
  const [tab, setTab] = useState<Tab>("unassigned");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsHidden, setDetailsHidden] = useState(false);
  const [status, setStatus] = useState("");
  const [tagId, setTagId] = useState("");
  // PRD 15: channel filter ("Semua saluran" + each channel).
  const [channelId, setChannelId] = useState("");
  // Staff (assignee) filter: the API already accepts assigneeUserId; this
  // exposes it in the toolbar.
  const [assigneeUserId, setAssigneeUserId] = useState("");
  // Filter (Faders) button: the status/tag toolbar starts hidden; the button
  // reveals it (owner request 2026-11-18).
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Chat Baru (+) button state.
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState("");
  const [newChatName, setNewChatName] = useState("");
  const [newChatBusy, setNewChatBusy] = useState(false);
  const [newChatError, setNewChatError] = useState<string | null>(null);

  // Allow deep-linking to a specific conversation via ?c=<id> (used by the
  // pipeline "Buka Chat" action and the notification bell). Only applied
  // once, on mount.
  useEffect(() => {
    const c = router.query.c;
    if (typeof c === "string" && c) {
      setSelectedId(c);
      // Deep links must mark the conversation read too - the in-list click
      // path does this via onSelect, this path bypassed it and the bell
      // badge stayed lit after opening from a notification.
      void apiSend(`/api/dashboard/inbox/conversations/${c}`, "POST")
        .then(() => {
          refresh();
          refreshNotifications();
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.c]);

  // Server-side filters (status + tag + staff) are appended to the API URL
  // so the list reflects them directly; tab/search/channel filter client-side
  // on top. PRD 28 Part A fix: the channel filter must NOT hit the server,
  // because the pills need the unfiltered per-channel counts - filtering the
  // query made every non-active pill count 0 and "Semua" show the filtered
  // subset instead of the total.
  const conversationsUrl =
    `/api/dashboard/inbox/conversations?pageSize=100` +
    (status ? `&status=${status}` : "") +
    (tagId ? `&tagId=${tagId}` : "") +
    (assigneeUserId ? `&assigneeUserId=${assigneeUserId}` : "");
  const { data, loading, error, refresh } = usePolledApi<ListResult<ConversationListItem>>(
    conversationsUrl,
    8000
  );

  // Tenant tags for the tag filter dropdown.
  const { data: tagsData } = useApi<ListResult<Tag>>(`/api/dashboard/tags?pageSize=100`);
  const tags = tagsData?.items ?? [];

  // Tenant team members for the staff filter dropdown.
  const { data: teamData } = useApi<{ items: TeamMember[] }>(
    "/api/dashboard/team?pageSize=100"
  );
  const members = teamData?.items ?? [];

  // Tenant channels for the channel filter dropdown (PRD 15).
  const { data: channelsData } = useApi<{ items: ChannelSummary[] }>(
    "/api/dashboard/channels"
  );
  const channels = channelsData?.items ?? [];

  const all = data?.items ?? [];
  const tabScoped = all.filter((c) => {
    // "Ditugaskan" scoping (owner request 2026-11-21): staff see only chats
    // assigned to THEMSELVES; the owner sees every human-assigned chat.
    if (tab === "assigned") {
      if (!isHumanAssigned(c)) return false;
      if (!isOwner && c.assignee?.id !== myUserId) return false;
    }
    if (tab === "unassigned" && isHumanAssigned(c)) return false;
    return true;
  });
  // PRD 28 Part A: channel filter is applied on top of the tab scope so the
  // pill badges can count from the tab-scoped set (tabScoped), not from the
  // already-channel-filtered list.
  const filtered = tabScoped.filter((c) => {
    if (channelId && c.channelId !== channelId) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.customerPhone.toLowerCase().includes(q) ||
        (c.contact?.name ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Tab badges follow the same scope as the tab content.
  const assignedCount = all.filter(
    (c) =>
      isHumanAssigned(c) &&
      (isOwner || c.assignee?.id === myUserId)
  ).length;
  const totals = {
    assigned: assignedCount,
    unassigned: all.filter((c) => !isHumanAssigned(c)).length,
  };

  const selected = selectedId ? all.find((c) => c.id === selectedId) ?? null : null;

  function onSelect(id: string) {
    setSelectedId(id);
    setDetailsOpen(false);
    // Opening a chat marks it read for this user (clears the unread badge).
    void apiSend(`/api/dashboard/inbox/conversations/${id}`, "POST").then(
      () => {
        refresh();
        refreshNotifications();
      }
    );
  }

  // Refresh conversation metadata after a details-pane mutation.
  function onConversationChanged() {
    void refresh();
  }

  function openNewChat() {
    setNewChatPhone("");
    setNewChatName("");
    setNewChatError(null);
    setNewChatOpen(true);
  }

  async function submitNewChat() {
    if (!newChatPhone.trim()) {
      setNewChatError("Nomor WhatsApp wajib diisi.");
      return;
    }
    setNewChatBusy(true);
    setNewChatError(null);
    try {
      const res = await apiSend<{ conversationId: string; created: boolean }>(
        "/api/dashboard/inbox/conversations",
        "POST",
        {
          phone: newChatPhone.trim(),
          ...(newChatName.trim() ? { name: newChatName.trim() } : {}),
        }
      );
      setNewChatOpen(false);
      // Reset the list filters so the new chat is visible, then open it.
      setStatus("");
      setTagId("");
      setChannelId("");
      void refresh();
      setSelectedId(res.conversationId);
      setDetailsOpen(false);
    } catch (err) {
      setNewChatError(err instanceof ApiError ? err.message : "Gagal memulai percakapan.");
    } finally {
      setNewChatBusy(false);
    }
  }

  return (
    <DashboardShell title="Percakapan" flush>
      {/* Filter toolbar - status + tag drive the server-side query; hidden
          until the Faders button reveals it (filtersOpen). */}
      {filtersOpen && (
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <Select
          value={status}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value)}
          className="h-8 w-auto text-xs"
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          <option value="OPEN">Open</option>
          <option value="PENDING">Pending</option>
          <option value="RESOLVED">Selesai</option>
        </Select>
        <Select
          value={tagId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setTagId(e.target.value)}
          className="h-8 w-auto text-xs"
          aria-label="Filter tag"
        >
          <option value="">Semua tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        <Select
          value={channelId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setChannelId(e.target.value)}
          className="h-8 w-auto text-xs"
          aria-label="Filter saluran"
        >
          <option value="">Semua saluran</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label || (c.provider === "CLOUD_API" ? "Resmi" : "Pribadi")}
              {c.phoneNumber ? ` (${c.phoneNumber})` : ""}
            </option>
          ))}
        </Select>
        <Select
          value={assigneeUserId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setAssigneeUserId(e.target.value)}
          className="h-8 w-auto text-xs"
          aria-label="Filter staf"
        >
          <option value="">Semua staf</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.email}
            </option>
          ))}
        </Select>
        <Button
          variant="ghost"
          className="h-8 text-xs"
          onClick={() => {
            setStatus("");
            setTagId("");
            setChannelId("");
            setAssigneeUserId("");
          }}
        >
          Reset
        </Button>
      </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ConversationList
          items={filtered}
          loading={loading}
          error={error}
          tab={tab}
          onTabChange={(t) => {
            setTab(t);
            setSearch("");
          }}
          search={search}
          onSearchChange={setSearch}
          selectedId={selectedId}
          onSelect={onSelect}
          totals={totals}
          mobileHidden={!!selectedId}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((v) => !v)}
          onNewChat={openNewChat}
          channels={channels}
          channelFilter={channelId}
          onChannelChange={(v) => {
            setChannelId(v);
            setFiltersOpen(false);
          }}
          badgeItems={tabScoped}
        />

        {selected ? (
          <ChatPanel
            conversationId={selected.id}
            customerName={selected.contact?.name ?? selected.customerPhoneDisplay}
            customerPhone={selected.customerPhoneDisplay}
            channelLabel={selected.channel.label || null}
            channelNumber={selected.channel.phoneNumber}
            avatarUrl={selected.avatarUrl}
            conversationChannelId={selected.channelId}
            replyChannelOverride={selected.replyChannelId}
            channels={channels}
            aiActive={!selected.assignee && !!selected.assignedAgent}
            humanTakenOver={!!selected.assignee}
            mediaBase={apiMediaBase}
            onBack={() => {
              setSelectedId(null);
              setDetailsOpen(false);
            }}
            onOpenDetails={() => setDetailsOpen(true)}
            onRead={() => void refresh()}
          />
        ) : (
          <div className="hidden flex-1 flex-col items-center justify-center bg-slate-50 text-center lg:flex">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              {/* chat icon placeholder */}
              <span className="text-2xl">💬</span>
            </div>
            <p className="text-sm font-semibold text-slate-900">Pilih percakapan</p>
            <p className="mt-1 text-sm text-slate-500">
              Pilih percakapan di sebelah kiri untuk mulai membalas pelanggan.
            </p>
          </div>
        )}

        {selected && (
          <ContactDetails
            conversation={selected}
            onChanged={onConversationChanged}
            mobileOpen={detailsOpen}
            onCloseMobile={() => setDetailsOpen(false)}
            hidden={detailsHidden}
            onToggleHide={() => setDetailsHidden((v) => !v)}
          />
        )}
      </div>

      {/* Chat Baru (the + button, owner request 2026-11-18). */}
      <Dialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        title="Mulai Percakapan Baru"
        description="Masukkan nomor WhatsApp pelanggan. Percakapan yang sudah ada akan dibuka kembali, bukan diduplikasi."
      >
        <div className="space-y-3.5">
          <div>
            <Label htmlFor="new-chat-phone">Nomor WhatsApp</Label>
            <Input
              id="new-chat-phone"
              value={newChatPhone}
              onChange={(e) => setNewChatPhone(e.target.value)}
              placeholder="Contoh: 081234567890"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="new-chat-name">Nama Pelanggan (opsional)</Label>
            <Input
              id="new-chat-name"
              value={newChatName}
              onChange={(e) => setNewChatName(e.target.value)}
              placeholder="Contoh: Budi Santoso"
            />
          </div>
          {newChatError && <p className="text-sm text-red-600">{newChatError}</p>}
          <p className="text-xs text-slate-500">
            Catatan: di saluran Resmi (Cloud API), pesan hanya bisa dikirim
            jika pelanggan baru saja mengirim pesan (jendela 24 jam).
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setNewChatOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={() => void submitNewChat()}
              disabled={newChatBusy}
              className="bg-green-600 hover:bg-green-700"
            >
              {newChatBusy ? "Memuat…" : "Buka Chat"}
            </Button>
          </div>
        </div>
      </Dialog>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async (ctx) => {
    // Outbound campaign images live on the api service; the chat renders
    // them from its origin (same fallback pattern as the campaigns page).
    const apiBase = (process.env.API_URL ?? "").replace(/\/$/, "");
    const fallback = (
      process.env.NEXTAUTH_URL ?? `https://${ctx.req.headers.host}`
    ).replace(/\/$/, "");
    return { props: { apiMediaBase: apiBase || fallback } };
  }
);
