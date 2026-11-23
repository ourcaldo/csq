import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ChatCircle,
  Copy,
  PaperPlaneRight,
  User,
  X,
} from "@phosphor-icons/react";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Select } from "@csq/ui/components/ui/select";
import { Textarea } from "@csq/ui/components/ui/textarea";
import { apiFetch, apiSend, ApiError } from "@/lib/api-client";
import type { Message, Stage } from "@csq/core/types/inbox";
import type { PipelineDeal } from "@csq/core/types/pipeline";
import {
  formatRupiah,
  initialOf,
  providerLabel,
  timeAgo,
} from "./format";

// Slide-over lead detail for the pipeline board (revamp 2026-11-16): stage +
// estimated value, last-message preview with a quick reply, contact info, and
// the internal contact note. Mounted per deal (keyed by id) so each open starts
// with fresh drafts.
type Props = {
  deal: PipelineDeal;
  stages: Stage[];
  onClose: () => void;
  /** Reload the board after a stage/value change or a reply. */
  onChanged: () => void;
  onOpenChat: (conversationId: string) => void;
  onOpenContact: (phone: string) => void;
  onToast: (message: string) => void;
};

function timeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function LeadDrawer(props: Props) {
  const deal = props.deal;
  const conversation = deal.conversation;
  const contact = conversation.contact;
  const session = useSession();
  // Contact notes need kontak.kelola (PUT /api/dashboard/contacts/[id]).
  const canEditNote =
    !!session.data?.user?.isOwner ||
    !!session.data?.user?.permissions?.includes("kontak.kelola");

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageName, setStageName] = useState(deal.stage.name);
  const [valueDraft, setValueDraft] = useState(String(deal.value));
  const [note, setNote] = useState(contact?.notes ?? "");
  const [noteSaved, setNoteSaved] = useState(false);

  // Last messages of the thread (the endpoint serves the newest slice).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch<{ items: Message[] }>(
          `/api/dashboard/inbox/conversations/${deal.conversationId}/messages?pageSize=8`
        );
        if (!cancelled) setMessages(res.items.filter((m) => !m.isInternal));
      } catch (err) {
        if (!cancelled) {
          setMessagesError(
            err instanceof ApiError ? err.message : "Gagal memuat percakapan."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deal.conversationId]);

  async function changeStage(next: string) {
    const previous = stageName;
    setStageName(next);
    setBusy(true);
    setError(null);
    try {
      await apiSend(
        `/api/dashboard/pipeline/deals/${deal.conversationId}`,
        "PATCH",
        { stage: next }
      );
      props.onToast(`Dipindahkan ke tahap "${next}"`);
      props.onChanged();
    } catch (err) {
      setStageName(previous);
      setError(err instanceof ApiError ? err.message : "Gagal memindahkan deal.");
    } finally {
      setBusy(false);
    }
  }

  async function saveValue() {
    const parsed = Number(valueDraft);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setValueDraft(String(deal.value));
      setError("Nilai deal harus angka bulat 0 atau lebih.");
      return;
    }
    if (parsed === deal.value) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(
        `/api/dashboard/pipeline/deals/${deal.conversationId}`,
        "PATCH",
        { value: parsed }
      );
      props.onToast(`Nilai deal: ${formatRupiah(parsed)}`);
      props.onChanged();
    } catch (err) {
      setValueDraft(String(deal.value));
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan nilai.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await apiSend<Message>(
        `/api/dashboard/inbox/conversations/${deal.conversationId}/messages`,
        "POST",
        { body }
      );
      setMessages((prev) => [...(prev ?? []), message].slice(-8));
      setReply("");
      props.onToast("Pesan terkirim ke WhatsApp");
      props.onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengirim pesan.");
    } finally {
      setSending(false);
    }
  }

  async function saveNote() {
    if (!contact || !canEditNote || note === (contact.notes ?? "")) return;
    try {
      await apiSend(`/api/dashboard/contacts/${contact.id}`, "PUT", {
        notes: note.trim() ? note : null,
      });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan catatan.");
    }
  }

  async function copyPhone() {
    try {
      await navigator.clipboard.writeText(conversation.customerPhoneDisplay);
      props.onToast(`Nomor ${conversation.customerPhoneDisplay} disalin`);
    } catch {
      props.onToast("Gagal menyalin nomor");
    }
  }

  const tags = conversation.tags;

  return (
    <>
      <div
        onClick={props.onClose}
        className="fixed inset-0 z-40 animate-in bg-slate-900/25 fade-in"
      />
      <aside className="fixed top-0 right-0 z-50 flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-2xl animate-in slide-in-from-right-8 duration-200 sm:w-[460px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-base font-bold text-green-700">
              {initialOf(contact?.name ?? conversation.customerPhoneDisplay)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="truncate text-base font-bold text-slate-900">
                  {conversation.customerPhoneDisplay}
                </h2>
                <button
                  type="button"
                  onClick={() => void copyPhone()}
                  title="Salin nomor"
                  className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-green-600"
                >
                  <Copy size={14} />
                </button>
              </div>
              <p className="truncate text-xs text-slate-500">
                {contact?.name ?? "Pelanggan"} - {providerLabel(conversation.channel.provider)}
                {" "}- Aktif {timeAgo(conversation.lastMessageAt)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {/* Stage + value */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Tahap Pipeline
              </span>
              <Select
                value={stageName}
                onChange={(e) => void changeStage(e.target.value)}
                disabled={busy}
                className="h-9 bg-white text-sm font-semibold"
              >
                {props.stages.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Estimasi Nilai (Rp)
              </span>
              <Input
                type="number"
                min={0}
                step={1000}
                value={valueDraft}
                onChange={(e) => setValueDraft(e.target.value)}
                onBlur={() => void saveValue()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                disabled={busy}
                className="h-9 bg-white text-sm font-bold text-green-700"
              />
            </label>
          </div>

          {/* Chat preview + quick reply */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Percakapan Terakhir
              </h3>
              <span className="text-[11px] text-slate-400">
                {messages?.length ?? 0} pesan
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-[#efeae2] p-3">
              {messages === null && !messagesError && (
                <p className="py-6 text-center text-xs text-slate-500">Memuat…</p>
              )}
              {messagesError && (
                <p className="py-6 text-center text-xs text-red-600">{messagesError}</p>
              )}
              {messages?.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-500">
                  Belum ada pesan di percakapan ini.
                </p>
              )}
              <div className="space-y-2">
                {(messages ?? []).map((m) => {
                  const outbound = m.direction === "OUTBOUND";
                  return (
                    <div
                      key={m.id}
                      className={"flex " + (outbound ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={
                          "max-w-[85%] rounded-xl px-3 py-2 text-xs shadow-sm " +
                          (outbound
                            ? "rounded-tr-none bg-[#d9fdd3] text-slate-800"
                            : "rounded-tl-none bg-white text-slate-800")
                        }
                      >
                        <p className="whitespace-pre-line leading-relaxed">
                          {m.body || (m.kind === "MEDIA" ? "[Gambar]" : "")}
                        </p>
                        <span className="mt-1 block text-right text-[10px] text-slate-400">
                          {timeOnly(m.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendReply();
                }}
                placeholder="Balas cepat ke WhatsApp pelanggan…"
                className="h-9 flex-1 text-sm"
              />
              <Button
                size="sm"
                onClick={() => void sendReply()}
                disabled={sending || !reply.trim()}
                className="h-9 gap-1.5 bg-green-600 px-3 hover:bg-green-700"
              >
                <PaperPlaneRight size={14} weight="fill" />
                {sending ? "…" : "Kirim"}
              </Button>
            </div>
          </div>

          {/* Contact info */}
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              Informasi Kontak &amp; Lead
            </h3>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-slate-500">Nomor Telepon</span>
                <span className="font-medium text-slate-900">
                  {conversation.customerPhoneDisplay}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-slate-500">Penanggung Jawab</span>
                <span className="font-medium text-slate-900">
                  {conversation.assignee?.name ??
                    conversation.assignee?.email ??
                    "Belum ditugaskan"}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-slate-500">Sumber Saluran</span>
                <span className="font-medium text-slate-900">
                  {providerLabel(conversation.channel.provider)}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-slate-500">Sumber Lead</span>
                <span className="font-medium text-slate-900">
                  {contact?.source ?? "-"}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-slate-500">Tag Pelanggan</span>
                <span className="flex flex-wrap justify-end gap-1">
                  {tags.length === 0 && <span className="text-slate-400">-</span>}
                  {tags.map((t) => (
                    <span
                      key={t.tag.id}
                      className="rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                    >
                      {t.tag.name}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          </div>

          {/* Internal note */}
          {contact && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Catatan Internal Tim
                </h3>
                <span
                  className={
                    "text-[11px] font-medium text-green-600 transition-opacity " +
                    (noteSaved ? "opacity-100" : "opacity-0")
                  }
                >
                  Tersimpan
                </span>
              </div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => void saveNote()}
                rows={3}
                placeholder={
                  canEditNote
                    ? "Kebutuhan pelanggan, jadwal follow-up, dll."
                    : "Hanya owner yang dapat mengubah catatan."
                }
                disabled={!canEditNote}
                className="bg-amber-50/40 text-sm disabled:opacity-70"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-slate-200 p-4">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            onClick={() => props.onOpenContact(conversation.customerPhoneDisplay)}
          >
            <User size={16} className="text-slate-500" />
            Buka Kontak
          </Button>
          <Button
            className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
            onClick={() => props.onOpenChat(deal.conversationId)}
          >
            <ChatCircle size={16} />
            Buka Chat
          </Button>
        </div>
      </aside>
    </>
  );
}
