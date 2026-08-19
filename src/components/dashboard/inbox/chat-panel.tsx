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
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { apiFetch, apiSend } from "@/lib/api-client";
import type { Message } from "@/types/inbox";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { EmptyState } from "@/components/dashboard/empty-state";

type ChatPanelProps = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  aiActive: boolean; // an AI agent is assigned (not handed to a human)
  /** Mobile back-to-list action. */
  onBack?: () => void;
};

type ComposerMode = "reply" | "note";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({ m }: { m: Message }) {
  if (m.isInternal) {
    return (
      <div className="my-1 flex justify-center">
        <div className="msg-note max-w-[80%] px-3 py-2 text-xs">
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
          {(m.body.charAt(0) || "?").toUpperCase()}
        </div>
        <div>
          <div className="msg-received px-3 py-2 text-sm shadow-sm">{m.body}</div>
          <span className="mt-1 ml-1 block text-[10px] text-slate-400">{timeLabel(m.createdAt)}</span>
        </div>
      </div>
    );
  }
  const isAi = m.senderType === "AGENT";
  return (
    <div className="my-1 flex max-w-[80%] items-end justify-end gap-2 self-end">
      <div>
        {isAi && (
          <span className="mb-1 ml-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            <Robot size={12} weight="fill" /> AI
          </span>
        )}
        <div
          className={cn(
            "px-3 py-2 text-sm shadow-sm",
            isAi ? "msg-ai" : "msg-sent"
          )}
        >
          {m.body}
        </div>
        <span className="mt-1 mr-1 block text-right text-[10px] text-slate-400">
          {timeLabel(m.createdAt)}
        </span>
      </div>
    </div>
  );
}

export function ChatPanel({ conversationId, customerName, customerPhone, aiActive, onBack }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ComposerMode>("reply");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function loadMessages() {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: Message[] }>(
        `/api/dashboard/inbox/conversations/${conversationId}/messages?pageSize=200`
      );
      setMessages(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat pesan.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setMessages(null);
    setDraft("");
    setSendError(null);
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Live updates: subscribe to the SSE stream for this conversation so AI
  // replies (and customer messages) appear without a manual refresh.
  useEffect(() => {
    const es = new EventSource(
      `/api/dashboard/inbox/stream?conversationId=${conversationId}`
    );
    es.onmessage = () => {
      void loadMessages();
    };
    es.onerror = () => {
      // Transient — the browser auto-reconnects; swallow.
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const endpoint =
        mode === "note"
          ? `/api/dashboard/inbox/conversations/${conversationId}/notes`
          : `/api/dashboard/inbox/conversations/${conversationId}/messages`;
      const created = await apiSend<Message>(endpoint, "POST", { body });
      setMessages((prev) => [...(prev ?? []), created]);
      setDraft("");
    } catch (err) {
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

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 px-6">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="-ml-1 rounded-md p-1 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Kembali ke daftar"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h2 className="text-lg font-semibold text-slate-900">{customerName}</h2>
          {aiActive ? (
            <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              <Robot size={12} weight="fill" /> AI menangani
            </span>
          ) : (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Diambil alih tim</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-slate-400">
          <button className="rounded-full p-2 hover:bg-slate-50" aria-label="Telepon">
            <Phone size={18} />
          </button>
          <button className="rounded-full p-2 hover:bg-slate-50" aria-label="Opsi">
            <DotsThreeVertical size={18} />
          </button>
        </div>
      </div>

      {/* AI stand-down banner */}
      {aiActive && (
        <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50/60 px-6 py-1.5 text-xs text-blue-700">
          <Robot size={14} weight="fill" />
          AI sedang menangani percakapan ini. Tugaskan ke tim untuk menghentikan AI.
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="scrollbar-slim flex flex-1 flex-col overflow-y-auto bg-slate-50/40 p-6">
        {loading && <LoadingSkeleton count={4} />}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && (messages?.length ?? 0) === 0 && (
          <EmptyState title="Belum ada pesan" description="Mulai percakapan dengan pelanggan." />
        )}
        {!loading &&
          !error &&
          messages?.map((m) => <MessageBubble key={m.id} m={m} />)}
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
          <button className="flex items-center gap-1 rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200">
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
            className="max-h-32 w-full resize-none border-none bg-transparent py-2 text-sm text-slate-700 placeholder-slate-400 focus:ring-0"
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
    </div>
  );
}
