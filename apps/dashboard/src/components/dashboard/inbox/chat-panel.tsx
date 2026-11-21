// Center pane of the CRM inbox: chat header, message thread, and composer.
// Owns the messages fetch for the selected conversation. Distinguishes customer
// (received), AI (blue), human reply (green sent), and private note (amber)
// bubbles. Composer has Reply / Private Note quick actions.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import {
  PaperPlaneRight,
  Smiley,
  Paperclip,
  NotePencil,
  Lightning,
  Robot,
  Code,
  DotsThreeVertical,
  Phone,
  ArrowLeft,
  UserCircle,
  Checks,
  FilePdf,
  CaretDown,
  CheckCircle,
  WhatsappLogo,
} from "@phosphor-icons/react";
import { cn } from "@csq/ui/lib/utils";
import { apiFetch, apiSend } from "@/lib/api-client";
import type { Message } from "@csq/core/types/inbox";
import type { MessageTemplate } from "@csq/core/lib/message-templates";
import { useSession } from "next-auth/react";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { EmptyState } from "@/components/dashboard/empty-state";

type ChatPanelProps = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  /** Channel identity for the header badge (PRD 15). */
  channelLabel: string | null;
  channelNumber: string | null;
  /** PRD 27: contact WhatsApp profile photo URL, null when absent. */
  avatarUrl: string | null;
  /** PRD 28 Part A: the conversation's current channel (default reply-from)
   * and the remembered override, plus all channels for the selector. */
  conversationChannelId: string;
  replyChannelOverride: string | null;
  channels: { id: string; label: string; provider: "CLOUD_API" | "BAILEYS"; phoneNumber: string | null }[];
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
  avatarUrl,
  myUserId,
}: {
  m: Message;
  readByAgent: boolean;
  mediaBase: string;
  customerInitial: string;
  avatarUrl: string | null;
  // Current session user - a staff reply shows its author's name only to
  // OTHER staff (owner request 2026-11-15).
  myUserId: string | null;
}) {
  // Whitespace-pre-line: agent replies carry markdown/newlines (lists, line
  // breaks) that must render as-written like WhatsApp does, not collapse.
  const bodyClass = "px-3 py-2 text-sm shadow-sm whitespace-pre-line";
  if (m.isInternal) {
    return (
      <div className="my-1 flex justify-center">
        <div className="msg-note max-w-[80%] px-3 py-2 text-xs whitespace-pre-line">
          {/* Who + when + what (owner request 2026-11-10): the note carries
              its author and time, not just the body. */}
          <span className="font-semibold">
            Catatan tim{m.senderUserName ? ` - ${m.senderUserName}` : ""}
          </span>{" "}
          <span className="text-slate-400">{timeLabel(m.createdAt)}</span>
          <div>{m.body}</div>
        </div>
      </div>
    );
  }
  const inbound = m.direction === "INBOUND";
  if (inbound) {
    return (
      <div className="my-1 flex max-w-[80%] items-end gap-2">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
            {/* Customer avatar: stable per conversation (contact-name or phone
                initial) - never the first letter of whatever they sent. */}
            {customerInitial}
          </div>
        )}
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
  const isApi = m.senderType === "API";
  // Staff replies show the author's name only when someone else is looking -
  // your own messages need no name label (owner request 2026-11-15).
  const showStaffName =
    m.senderType === "HUMAN" &&
    !!m.senderUserName &&
    m.senderUserId !== myUserId;
  return (
    <div className="my-1 flex max-w-[80%] items-end justify-end gap-2 self-end">
      <div>
        {isAi && (
          <span className="mb-1 ml-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            <Robot size={12} weight="fill" /> AI
          </span>
        )}
        {isApi && (
          <span className="mb-1 ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            <Code size={12} weight="bold" /> API
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
        {showStaffName && (
          <span className="mb-1 ml-1 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {m.senderUserName}
          </span>
        )}
        <div
          className={cn(
            bodyClass,
            isScenario || isCampaign ? "msg-scenario" : isAi ? "msg-ai" : "msg-sent"
          )}
        >
          {/* Outbound media: documents render as a file card; images render
              the real image with the caption below in the same bubble. */}
          {m.mediaId && m.filename && (
            <a
              href={`${mediaBase}/api/media/${m.mediaId}`}
              target="_blank"
              rel="noreferrer"
              className="mb-1 flex items-center gap-2 rounded-md bg-slate-900/5 px-2.5 py-2 hover:bg-slate-900/10"
            >
              <FilePdf size={22} className="shrink-0 text-red-500" />
              <span className="min-w-0 truncate text-xs font-medium text-slate-700">
                {m.filename}
              </span>
            </a>
          )}
          {m.mediaId && !m.filename && (
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

export function ChatPanel({ conversationId, customerName, customerPhone, channelLabel, channelNumber, avatarUrl, conversationChannelId, replyChannelOverride, channels, aiActive, humanTakenOver, mediaBase, onBack, onOpenDetails, onRead }: ChatPanelProps) {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ComposerMode>("reply");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [fileSending, setFileSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Slash-command template picker (owner request 2026-11-19): typing "/" in
  // the composer opens an inline autocomplete above the input - arrow keys
  // navigate, Enter/click selects. Replaces the template popup dialog.
  const [slashIndex, setSlashIndex] = useState(0);
  const [templateLang, setTemplateLang] = useState("id");
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [templateSending, setTemplateSending] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  // PRD 28 Part A: reply-from channel selector. Local state mirrors the
  // server-persisted override (Conversation.settings.replyChannelId); the
  // PATCH fires on change so the pick survives sessions and devices.
  const [replyFrom, setReplyFrom] = useState<string>(
    replyChannelOverride ?? conversationChannelId
  );
  const [chMenuOpen, setChMenuOpen] = useState(false);
  useEffect(() => {
    setReplyFrom(replyChannelOverride ?? conversationChannelId);
  }, [conversationId, conversationChannelId, replyChannelOverride]);

  async function pickReplyChannel(id: string) {
    setReplyFrom(id);
    setChMenuOpen(false);
    try {
      await apiSend(`/api/dashboard/inbox/conversations/${conversationId}`, "PATCH", {
        replyChannelId: id === conversationChannelId ? null : id,
      });
    } catch {
      // The override is a preference - a failed persist must not block chat.
    }
  }
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
      // Own optimistic reply: carry the session user id so the staff-name
      // label logic (name only for OTHER staff) works before reconciliation.
      senderUserId: session?.user?.id ?? null,
      // The author's name for the optimistic note bubble; replaced by the
      // server row (same field) once the POST resolves.
      senderUserName:
        session?.user?.name ?? session?.user?.email ?? null,
      body,
      waMessageId: null,
      kind: "TEXT",
      mediaId: null,
      filename: null,
      isInternal: mode === "note",
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    try {
      const endpoint =
        mode === "note"
          ? `/api/dashboard/inbox/conversations/${conversationId}/notes`
          : `/api/dashboard/inbox/conversations/${conversationId}/messages`;
      // PRD 28 Part A: send through the selected channel when the staff
      // overrode the default (matches sendHumanReply's channelOverrideId).
      const payload =
        mode === "reply" && replyFrom !== conversationChannelId
          ? { body, channelId: replyFrom }
          : { body };
      const created = await apiSend<Message>(endpoint, "POST", payload);
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
    // Slash-command picker: arrows navigate, Enter selects, Escape closes
    // (clears the "/" query by blanking the draft's command part).
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chooseTemplate(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDraft("");
        setSlashIndex(0);
        return;
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Attachment send (PRD 24 amendment 2026-11-18): the picked file is POSTed
  // raw to the media endpoint with the filename on the query string; the
  // server stores the MediaAsset and sends through the same pipeline as a
  // typed reply. The draft, when present, rides as the caption header.
  async function sendFile(file: File) {
    if (fileSending) return;
    setFileSending(true);
    setSendError(null);
    try {
      const caption = draft.trim();
      const created = await fetch(
        `/api/dashboard/inbox/conversations/${conversationId}/media?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            ...(caption ? { "X-Caption": encodeURIComponent(caption) } : {}),
          },
          body: file,
        }
      ).then((r) => {
        if (!r.ok) {
          return r.json().then((data: { error?: { message?: string } }) => {
            throw new Error(data.error?.message ?? "Gagal mengirim berkas.");
          });
        }
        return r.json();
      });
      const message: Message = created.data;
      setMessages((prev) => [...(prev ?? []), message]);
      if (caption) setDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Gagal mengirim berkas.");
    } finally {
      setFileSending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Slash-command autocomplete: active when the draft starts with "/" (reply
  // mode only). The query is the text after the slash; matching is
  // case-insensitive over label + key. CSQ templates fill the input; META
  // templates are sent via the template endpoint (they cannot go as free
  // text). Templates load once on mount.
  useEffect(() => {
    if (templates !== null) return;
    void apiFetch<{ items: MessageTemplate[] }>("/api/dashboard/templates")
      .then((data) => setTemplates(data.items))
      .catch(() => setTemplates([]));
  }, [templates]);

  const slashQuery =
    mode === "reply" && draft.startsWith("/") ? draft.slice(1).toLowerCase() : null;
  const slashMatches = useMemo(() => {
    const list = templates ?? [];
    if (slashQuery === null) return [];
    return list.filter(
      (t) =>
        t.label.toLowerCase().includes(slashQuery) || t.key.toLowerCase().includes(slashQuery)
    );
  }, [templates, slashQuery]);
  const slashOpen = slashQuery !== null && slashMatches.length > 0;
  const activeTemplate = slashOpen ? slashMatches[Math.min(slashIndex, slashMatches.length - 1)] : null;

  function chooseTemplate(t: MessageTemplate) {
    setTemplateError(null);
    if (t.kind === "CSQ") {
      // Free-text template: drop the body into the input for editing, then
      // send with Enter as usual.
      setDraft(t.body);
      setSlashIndex(0);
      textareaRef.current?.focus();
    } else {
      // Meta-approved template: cannot be sent as free text - send directly.
      void sendTemplate(t);
      setDraft("");
      setSlashIndex(0);
    }
  }

  async function sendTemplate(selectedTemplate: MessageTemplate) {
    if (templateSending) return;
    setTemplateSending(true);
    setTemplateError(null);
    try {
      // CSQ: the saved body is sent as a normal reply (24h window applies,
      // same as typing it by hand). META: the pre-approved template name goes
      // to Meta - the only compliant path outside the 24h window.
      const created =
        selectedTemplate.kind === "CSQ"
          ? await apiSend<Message>(
              `/api/dashboard/inbox/conversations/${conversationId}/messages`,
              "POST",
              { body: selectedTemplate.body }
            )
          : await apiSend<Message>(
              `/api/dashboard/inbox/conversations/${conversationId}/template`,
              "POST",
              {
                templateName: selectedTemplate.metaName,
                language: selectedTemplate.metaLanguage ?? templateLang,
              }
            );
      setMessages((prev) => [...(prev ?? []), created]);
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
          {(channelLabel || channelNumber) && (
            <span
              className="shrink-0 rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
              title={channelNumber ?? undefined}
            >
              {channelLabel ?? "WhatsApp"}{channelNumber ? ` - ${channelNumber}` : ""}
            </span>
          )}
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
              avatarUrl={avatarUrl}
              myUserId={session?.user?.id ?? null}
              readByAgent={
                m.direction === "INBOUND" &&
                !!messages.some(
                  (later) =>
                    later.createdAt > m.createdAt &&
                    (later.senderType === "AGENT" ||
                      later.senderType === "HUMAN" ||
                      later.senderType === "API")
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
        {templateError && <p className="mb-2 text-xs text-red-600">{templateError}</p>}

        {/* Slash-command template picker: inline above the input (owner
            request 2026-11-19 - no popup). Arrow keys + Enter or click. */}
        {slashOpen && (
          <div className="mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <p className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Template - {slashMatches.length} cocok
            </p>
            <div className="max-h-52 overflow-y-auto">
              {slashMatches.map((t, i) => (
                <button
                  key={t.id}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => chooseTemplate(t)}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors",
                    i === Math.min(slashIndex, slashMatches.length - 1)
                      ? "bg-green-50"
                      : "hover:bg-slate-50"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-slate-900">{t.label}</p>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          t.kind === "META" ? "bg-blue-50 text-blue-700" : "bg-green-100 text-green-700"
                        )}
                      >
                        {t.kind === "META" ? "Meta" : "CSQ"}
                      </span>
                    </div>
                    {t.kind === "CSQ" ? (
                      <p className="mt-0.5 truncate text-xs text-slate-500">{t.body}</p>
                    ) : (
                      <p className="mt-0.5 truncate font-mono text-xs text-slate-500">
                        {t.metaName} ({t.metaLanguage ?? "id"}) - kirim di luar 24 jam
                      </p>
                    )}
                  </div>
                  {i === Math.min(slashIndex, slashMatches.length - 1) && (
                    <kbd className="mt-1 shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                      Enter
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

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
          <span className="self-center text-[11px] text-slate-400">
            Ketik <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono">/</kbd> untuk template
          </span>
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

          {/* PRD 28 Part A: reply-from channel selector chip. Shows which
              number the reply will be sent from; click opens the popover. */}
          {mode === "reply" && channels.length > 0 && (
            <div className="relative shrink-0 self-center">
              <button
                type="button"
                onClick={() => setChMenuOpen((v) => !v)}
                title="Saluran yang dipakai membalas"
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white transition",
                  (channels.find((c) => c.id === replyFrom)?.provider ?? "") === "CLOUD_API"
                    ? "bg-blue-600"
                    : "bg-green-600"
                )}
              >
                {(channels.find((c) => c.id === replyFrom)?.provider ?? "") === "CLOUD_API" ? (
                  <CheckCircle size={13} weight="fill" className="text-white" />
                ) : (
                  <WhatsappLogo size={13} weight="fill" className="text-white" />
                )}
                {channels.find((c) => c.id === replyFrom)?.label ?? "Saluran"}
                <CaretDown size={10} className="opacity-70" />
              </button>
              {chMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setChMenuOpen(false)} />
                  <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                    <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Kirim dari saluran
                    </p>
                    {channels.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => void pickReplyChannel(c.id)}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
                          {c.provider === "CLOUD_API" ? (
                            <CheckCircle size={15} weight="fill" className="shrink-0 text-blue-600" />
                          ) : (
                            <WhatsappLogo size={15} weight="fill" className="shrink-0 text-green-600" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate">{c.label}</span>
                            {c.phoneNumber && (
                              <span className="block font-mono text-[10px] text-slate-400">
                                {c.phoneNumber}
                              </span>
                            )}
                          </span>
                        </span>
                        {replyFrom === c.id && <CheckCircle size={14} weight="fill" className="shrink-0 text-green-600" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
              setDraft(e.target.value);
              setSlashIndex(0);
            }}
            onKeyDown={onKey}
            placeholder={
              mode === "note"
                ? "Tulis catatan internal untuk tim…"
                : `Balas ke ${customerPhone}… (ketik / untuk template)`
            }
            className="max-h-32 w-full resize-none border-none bg-transparent py-2 text-sm text-slate-700 outline-none placeholder-slate-400 focus:outline-none focus:ring-0"
          />
          <div className="flex shrink-0 gap-1 pb-1">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void sendFile(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={fileSending || mode === "note"}
              className="p-2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
              aria-label="Lampiran"
              title="Kirim gambar atau dokumen"
            >
              <Paperclip size={20} className={fileSending ? "animate-pulse" : ""} />
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
    </div>
  );
}
