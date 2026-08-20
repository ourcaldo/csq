// CRM Inbox — the flagship dashboard view. Three panes: conversation list,
// chat panel, and contact details. Full-bleed inside the shell (flush mode).
// Owner/staff see all tenant conversations; selecting one opens the chat.
// Handoff (take over / release) and tag/status actions live in the details pane.
import { useState } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@/types/dashboard";
import type { ConversationListItem } from "@/types/inbox";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ConversationList } from "@/components/dashboard/inbox/conversation-list";
import { ChatPanel } from "@/components/dashboard/inbox/chat-panel";
import { ContactDetails } from "@/components/dashboard/inbox/contact-details";

type Tab = "assigned" | "unassigned";

function isHumanAssigned(c: ConversationListItem): boolean {
  return !!c.assignee;
}

export default function InboxPage() {
  const [tab, setTab] = useState<Tab>("unassigned");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Fetch all tenant conversations; tab/search filter client-side for MVP.
  const { data, loading, error, refresh } = useApi<ListResult<ConversationListItem>>(
    `/api/dashboard/inbox/conversations?pageSize=100`
  );

  const all = data?.items ?? [];
  const filtered = all.filter((c) => {
    if (tab === "assigned" && !isHumanAssigned(c)) return false;
    if (tab === "unassigned" && isHumanAssigned(c)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.customerPhone.toLowerCase().includes(q) ||
        (c.contact?.name ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totals = {
    assigned: all.filter(isHumanAssigned).length,
    unassigned: all.filter((c) => !isHumanAssigned(c)).length,
  };

  const selected = selectedId ? all.find((c) => c.id === selectedId) ?? null : null;

  function onSelect(id: string) {
    setSelectedId(id);
  }

  // Refresh conversation metadata after a details-pane mutation.
  function onConversationChanged() {
    void refresh();
  }

  return (
    <DashboardShell title="Percakapan" flush>
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
        />

        {selected ? (
          <ChatPanel
            conversationId={selected.id}
            customerName={selected.contact?.name ?? selected.customerPhoneDisplay}
            customerPhone={selected.customerPhoneDisplay}
            aiActive={!selected.assignee && !!selected.assignedAgent}
            humanTakenOver={!!selected.assignee}
            onBack={() => setSelectedId(null)}
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
          />
        )}
      </div>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
