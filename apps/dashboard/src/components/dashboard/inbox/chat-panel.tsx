// Center pane of the CRM inbox: chat header, message thread, and composer.
// Owns the messages fetch for the selected conversation. Distinguishes customer
// (received), AI (blue), human reply (green sent), and private note (amber)
// bubbles. Composer has Reply / Private Note quick actions.
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import {
  PaperPlaneRight,
  Smiley,
  Paperclip,
  NotePencil,
  Lightning,
  FileText,
  Robot,
  DotsThreeVertical,
  Phone,
  ArrowLeft,
  UserCircle,
  Checks,
} from "@phosphor-icons/react";
import { cn } from "@csq/ui/lib/utils";
import { apiFetch, apiSend } from "@/lib/api-client";
import type { Message } from "@csq/core/types/inbox";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Dialog } from "@csq/ui/components/ui/dialog";

type ChatPanelProps = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  aiActive: boolean; // an AI agent is assigned (not handed to a human)
  humanTakenOver: boolean; // a human staff member has taken over
  /** Origin that serves /api/media (the api service in the monorepo split). */
  mediaBase: string;
  /** Mobile back-to-list action. */
  onBack?: () => void;
  /** Mobile open-contact-details action (opens the slide-over drawer). */
  onOpenDetails?: () => void;
  /** Fired after the panel advances the user's read watermark, so the page
   * can refresh the list and clear the unread badge promptly. */
  onRead?: () => void;
};

type ComposerMode = "reply" | "note";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({
  m,
  readByAgent,
  mediaBase,
  customerInitial,
}: {
  m: Message;
  readByAgent: boolean;
  mediaBase: string;
  customerInitial: string;
}) {
  // Whitespace-pre-line: agent replies carry markdown/newlines (lists, line
  // breaks) that must render as-written like WhatsApp does, not collapse.
  const bodyClass = "px-3 py-2 text-sm shadow-sm whitespace-pre-line";
  if (m.isInternal) {
    return (
      <div className="my-1 flex justify-center">
        <div className="msg-note max-w-[80%] px-3 py-2 text-xs whitespace-pre-line">
          <span className="font-semibold">Catatan tim: </span>
          {m.body}
        </div>
      </div>
    );
  }
  const inbound = m.direction === "INBOUND";
  if (inbound) {
    return (
      <div className="my-1 flex max-w-[80%] items-end gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {/* Customer avatar: stable per conversation (contact-name or phone
              initial) - never the first letter of whatever they sent. */}
          {customerInitial}
        </div>
        <div>
          <div className={cn("msg-received", bodyClass)}>
            {/* Inbound media (customer photos): render the real image with the
                caption below it in the same bubble. */}
            {m.mediaId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${mediaBase}/api/media/${m.mediaId}`}
                alt="Gambar pelanggan"
                className="mb-1 max-h-64 w-full rounded-md object-cover"
              />
            )}
            {m.body}
          </div>
          <span className="mt-1 ml-1 block text-[10px] text-slate-400">{timeLabel(m.createdAt)}</span>
        </div>
      </div>
    );
  }
  const isAi = m.senderType === "AGENT";
  const isCampaign = m.senderType === "CAMPAIGN";
  const isScenario = m.senderType === "SCENARIO";
  return (
    <div className="my-1 flex max-w-[80%] items-end justify-end gap-2 self-end">
      <div>
        {isAi && (
          <span className="mb-1 ml-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            <Robot size={12} weight="fill" /> AI
          </span>
        )}
        {isCampaign && (
          <span className="mb-1 ml-1 inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
            Kampanye
          </span>
        )}
        {isScenario && (
          <span className="mb-1 ml-1 inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
            Skenario
          </span>
        )}
        <div
          className={cn(
            bodyClass,
            isScenario || isCampaign ? "msg-scenario" : isAi ? "msg-ai" : "msg-sent"
          )}
        >
          {/* Outbound media (campaign images): render the real image; the
              caption rides below it in the same bubble. */}
          {m.mediaId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${mediaBase}/api/media/${m.mediaId}`}
              alt="Gambar"
              className="mb-1 max-h-64 w-full rounded-md object-cover"
            />
          )}
          {m.body}
        </div>
        <span className="mt-1 mr-1 flex items-center justify-end gap-1 text-[10px] text-slate-400">
          {readByAgent && (
            <span className="text-blue-500" aria-label="Dibaca AI" title="Dibaca AI">
              <Checks size={13} weight="bold" />
            </span>
          )}
          {timeLabel(m.createdAt)}
        </span>
      </div>
    </div>
  );
}

// WhatsApp-style "AI sedang mengetik…" indicator: three pulsing dots.
function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="my-1 flex max-w-[80%] items-end justify-end gap-2 self-end">
      <div>
        <span className="mb-1 ml-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
          <Robot size={12} weight="fill" /> AI
        </span>
        <div className="msg-ai px-3 py-2 text-sm shadow-sm">
          <span className="inline-flex items-center gap-1">
            <span className="text-xs text-slate-500">{label}</span>
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ conversationId, customerName, customerPhone, aiActive, humanTakenOver, mediaBase, onBack, onOpenDetails, onRead }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ComposerMode>("reply");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("id");
  const [templateSending, setTemplateSending] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // First render of a conversation's messages vs a silent background refresh.
  const hadMessagesRef = useRef(false);
  // Last server-side message id we rendered; a silent refresh that grows the
  // thread means the customer (or AI) wrote while this panel is open.
  const lastIdRef = useRef<string | null>(null);

  // Stable per-conversation avatar initial, same rule as the left list.
  const customerInitial = customerName.trim().charAt(0).toUpperCase() || "?";

  // Advance the caller's read watermark. Opening the chat marks it read once
  // (page onSelect); this keeps it advancing while the panel is open and on
  // replies, so the unread badge cannot stick (owner report 2026-11-10: it
  // stayed at 6 through six owner replies).
  function markRead() {
    void apiSend(`/api/dashboard/inbox/conversations/${conversationId}`, "POST")
      .then(() => onRead?.())
      .catch(() => undefined);
  }

  async function loadMessages(showLoading: boolean) {
    if (showLoading) setLoading(true);
    try {
      const data = await apiFetch<{ items: Message[] }>(
        `/api/dashboard/inbox/conversations/${conversationId}/messages?pageSize=200`
      );
      setMessages((prev) => {
        // Silent SSE refreshes must keep bubbles whose POST has not
        // resolved yet (optimistic sends), or they flash out mid-flight.
        const pending = (prev ?? []).filter((m) => m.id.startsWith("pending-"));
        return pending.length ? [...data.items, ...pending] : data.items;
      });
      setError(null);
      const lastId = data.items.at(-1)?.id ?? null;
      if (!showLoading && lastId && lastId !== lastIdRef.current) {
        markRead();
      }
      lastIdRef.current = lastId;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat pesan.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    setMessages(null);
    setDraft("");
    setSendError(null);
    hadMessagesRef.current = false;
    lastIdRef.current = null;
    void loadMessages(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages === null) return;
    const firstLoad = !hadMessagesRef.current;
    hadMessagesRef.current = true;
    // Silent SSE refreshes must not yank the user back to the bottom while
    // they are scrolled up reading history; the first load always pins to
    // the newest message.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (firstLoad || nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Live updates: subscribe to the SSE stream for this conversation so AI
  // replies (and customer messages) appear without a manual refresh.
  useEffect(() => {
    const es = new EventSource(
      `/api/dashboard/inbox/stream?conversationId=${conversationId}`
    );
    // The server tracks "last seen" from the moment the SSE connects - any
    // message that arrived while the connection was down (proxy timeout,
    // deploy, laptop sleep) is never replayed. Re-fetch the full history on
    // every (re)connect so the panel is always back in sync.
    es.onopen = () => {
      void loadMessages(false);
    };
    es.onmessage = () => {
      // Silent: a skeleton flash on every live message is what made the
      // thread look like it was "refreshing" (owner report 2026-11-10).
      void loadMessages(false);
    };
    es.onerror = () => {
      // Transient - the browser auto-reconnects; swallow.
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    setDraft("");
    // Optimistic bubble (owner report 2026-11-10): the send POST waits for
    // the worker's outbox drain (~1-2s), so the message is appended to the
    // thread immediately and reconciled with the real row when the POST
    // resolves. On failure the bubble is removed and the draft restored.
    const pendingId = `pending-${Date.now()}`;
    const optimistic: Message = {
      id: pendingId,
      conversationId,
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderAgentId: null,
      senderUserId: null,
      body,
      waMessageId: null,
      kind: "TEXT",
      mediaId: null,
      isInternal: mode === "note",
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    try {
      const endpoint =
        mode === "note"
          ? `/api/dashboard/inbox/conversations/${conversationId}/notes`
          : `/api/dashboard/inbox/conversations/${conversationId}/messages`;
      const created = await apiSend<Message>(endpoint, "POST", { body });
      setMessages((prev) => (prev ?? []).map((m) => (m.id === pendingId ? created : m)));
      // Replying means the thread was read: advance the watermark so the
      // left-panel badge clears instead of sticking.
      if (mode === "reply") markRead();
    } catch (err) {
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== pendingId));
      setDraft(body);
      setSendError(err instanceof Error ? err.message : "Gagal mengirim.");
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Send an approved WhatsApp template - used to reach a customer outside the
  // 24h Cloud API window. The template must be pre-approved in Meta Business
  // Manager; the operator supplies its name + language code.
  async function sendTemplate() {
    const name = templateName.trim();
    if (!name || templateSending) return;
    setTemplateSending(true);
    setTemplateError(null);
    try {
      const created = await apiSend<Message>(
        `/api/dashboard/inbox/conversations/${conversationId}/template`,
        "POST",
        { templateName: name, language: templateLang }
      );
      setMessages((prev) => [...(prev ?? []), created]);
      setTemplateOpen(false);
      setTemplateName("");
      setTemplateLang("id");
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Gagal mengirim template.");
    } finally {
      setTemplateSending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="-ml-1 shrink-0 rounded-md p-1 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Kembali ke daftar"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h2 className="truncate text-lg font-semibold text-slate-900">{customerName}</h2>
          {aiActive ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              <Robot size={12} weight="fill" /> AI menangani
            </span>
          ) : humanTakenOver ? (
            <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Diambil alih tim</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-slate-400">
          {onOpenDetails && (
            <button
              onClick={onOpenDetails}
              className="rounded-full p-2 hover:bg-slate-50 lg:hidden"
              aria-label="Detail kontak"
            >
              <UserCircle size={20} />
            </button>
          )}
          <button className="hidden rounded-full p-2 hover:bg-slate-50 sm:block" aria-label="Telepon">
            <Phone size={18} />
          </button>
          <button className="hidden rounded-full p-2 hover:bg-slate-50 sm:block" aria-label="Opsi">
            <DotsThreeVertical size={18} />
          </button>
        </div>
      </div>

      {/* AI stand-down banner */}
      {aiActive && (
        <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50/60 px-4 py-1.5 text-xs text-blue-700 md:px-6">
          <Robot size={14} weight="fill" />
          AI sedang menangani percakapan ini. Tugaskan ke tim untuk menghentikan AI.
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="scrollbar-slim flex flex-1 flex-col overflow-y-auto bg-slate-50/40 p-4 md:p-6">
        {loading && <LoadingSkeleton count={4} />}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && (messages?.length ?? 0) === 0 && (
          <EmptyState title="Belum ada pesan" description="Mulai percakapan dengan pelanggan." />
        )}
        {/* Not gated on !loading/!error: a background (SSE) refresh or a
            transient error must never blank the thread - that was the
            "screen refresh" flash. */}
        {messages?.map((m) => (
            <MessageBubble
              key={m.id}
              m={m}
              mediaBase={mediaBase}
              customerInitial={customerInitial}
              readByAgent={
                m.direction === "INBOUND" &&
                !!messages.some(
                  (later) =>
                    later.createdAt > m.createdAt &&
                    (later.senderType === "AGENT" ||
                      later.senderType === "HUMAN")
                )
              }
            />
          ))}
        {/* Agent turn in flight: the last message is a customer inbound with
            no business reply after it yet - the agent loop is processing it
            (webhook fires the loop on ingest). Show WhatsApp-style dots. */}
        {aiActive && !loading && !error && messages && (() => {
          const last = messages[messages.length - 1];
          if (!last || last.direction !== "INBOUND") return null;
          return <TypingIndicator label="AI sedang mengetik" />;
        })()}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-slate-100 bg-white p-4">
        {sendError && <p className="mb-2 text-xs text-red-600">{sendError}</p>}

        {/* Quick actions */}
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setMode("reply")}
            className={cn(
              "flex items-center gap-1 rounded-md px-3 py-1.5 text-xs transition-colors",
              mode === "reply"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Lightning size={14} /> Balas
          </button>
          <button
            onClick={() => setMode("note")}
            className={cn(
              "flex items-center gap-1 rounded-md px-3 py-1.5 text-xs transition-colors",
              mode === "note"
                ? "bg-amber-500 text-white"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
            )}
          >
            <NotePencil size={14} /> Catatan Tim
          </button>
          <button
            onClick={() => { setTemplateOpen(true); setTemplateError(null); }}
            className="flex items-center gap-1 rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200"
          >
            <FileText size={14} /> Template
          </button>
        </div>

        {/* Input */}
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border p-2 transition-all focus-within:ring-2",
            mode === "note"
              ? "border-amber-300 bg-amber-50/40 focus-within:ring-amber-100"
              : "border-slate-200 bg-slate-50 focus-within:border-green-300 focus-within:ring-green-100"
          )}
        >
          <button className="shrink-0 p-2 text-slate-400 hover:text-slate-600" aria-label="Emoji">
            <Smiley size={20} />
          </button>
          <textarea
            rows={1}
            value={draft}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={
              mode === "note"
                ? "Tulis catatan internal untuk tim…"
                : `Balas ke ${customerPhone}…`
            }
            className="max-h-32 w-full resize-none border-none bg-transparent py-2 text-sm text-slate-700 outline-none placeholder-slate-400 focus:outline-none focus:ring-0"
          />
          <div className="flex shrink-0 gap-1 pb-1">
            <button className="p-2 text-slate-400 hover:text-slate-600" aria-label="Lampiran">
              <Paperclip size={20} />
            </button>
            <button
              onClick={send}
              disabled={sending || !draft.trim()}
              className={cn(
                "flex items-center justify-center rounded-lg p-2 text-white transition-colors disabled:opacity-50",
                mode === "note" ? "bg-amber-500 hover:bg-amber-600" : "bg-green-500 hover:bg-green-600"
              )}
              aria-label="Kirim"
            >
              <PaperPlaneRight size={20} weight="fill" />
            </button>
          </div>
        </div>
      </div>

      {/* Template send dialog - for messaging outside the 24h window. */}
      <Dialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        title="Kirim Template"
        description="Pesan template disetujui untuk mengirim di luar jendela 24 jam."
      >
        {templateError && <p className="mb-2 text-xs text-red-600">{templateError}</p>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nama Template</label>
            <input
              value={templateName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTemplateName(e.target.value)}
              placeholder="contoh: order_confirmation"
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Bahasa</label>
            <input
              value={templateLang}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTemplateLang(e.target.value)}
              placeholder="id"
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setTemplateOpen(false)}
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              onClick={sendTemplate}
              disabled={templateSending || !templateName.trim()}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {templateSending ? "Mengirim…" : "Kirim Template"}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
