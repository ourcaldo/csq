// Right pane of the CRM inbox: contact info, tags, human/AI handoff, and status.
// "Take over" assigns the conversation to the current user (stands the AI down,
// FR-AS-003); "Release" unassigns so the AI resumes. Tags add/remove via the
// tags API. Status via PATCH on the conversation.
import { useEffect, useState } from "react";
import {
  Tag as TagIcon,
  EnvelopeSimple,
  Phone,
  MapPin,
  Plus,
  X,
  Hand,
  ArrowUp,
  WhatsappLogo,
  PencilSimple,
  FloppyDisk,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { apiFetch, apiSend } from "@/lib/api-client";
import { Select } from "@/components/ui/select";
import type { ConversationListItem, Stage, Tag } from "@/types/inbox";
import { useSession } from "next-auth/react";

type ContactDetailsProps = {
  conversation: ConversationListItem;
  onChanged: () => void; // tell parent to refresh conversation metadata
};

export function ContactDetails({ conversation, onChanged }: ContactDetailsProps) {
  const { data: session } = useSession();
  const me = session?.user?.id;
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);

  async function loadTags() {
    try {
      const data = await apiFetch<{ items: Tag[] }>("/api/dashboard/tags?pageSize=200");
      setTags(data.items);
    } catch {
      setTags([]);
    }
  }

  async function loadStages() {
    try {
      const data = await apiFetch<{ stages: Stage[] }>("/api/dashboard/pipeline");
      setStages(data.stages);
    } catch {
      setStages([]);
    }
  }

  // Load tenant tags + pipeline stages once.
  useEffect(() => {
    void loadTags();
    void loadStages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/inbox/conversations/${conversation.id}`, "PATCH", body);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memperbarui.");
    } finally {
      setBusy(false);
    }
  }

  // Move the conversation's deal to a new stage (human manual change).
  // Hits the pipeline deal endpoint, not the conversation PATCH.
  async function setStage(stageName: string) {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/pipeline/deals/${conversation.id}`, "PATCH", { stage: stageName });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah tahap.");
    } finally {
      setBusy(false);
    }
  }

  async function saveContact() {
    if (!contact) return;
    setSavingContact(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/contacts/${contact.id}`, "PUT", {
        name: editName.trim() || null,
        email: editEmail.trim() || null,
        notes: editNotes.trim() || null,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan kontak.");
    } finally {
      setSavingContact(false);
    }
  }

  function startEdit() {
    setEditName(contact?.name ?? "");
    setEditEmail(contact?.email ?? "");
    setEditNotes(contact?.notes ?? "");
    setEditing(true);
  }

  async function addTag(tagId: string) {
    setBusy(true);
    try {
      await apiSend(`/api/dashboard/inbox/conversations/${conversation.id}/tags`, "POST", { tagId });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah tag.");
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tagId: string) {
    setBusy(true);
    try {
      await apiSend(
        `/api/dashboard/inbox/conversations/${conversation.id}/tags?tagId=${encodeURIComponent(tagId)}`,
        "DELETE"
      );
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus tag.");
    } finally {
      setBusy(false);
    }
  }

  const contact = conversation.contact;
  const assignedToMe = !!conversation.assignee && conversation.assignee.id === me;
  const usedTagIds = new Set(conversation.tags.map((t) => t.tag.id));
  const availableTags = (tags ?? []).filter((t) => !usedTagIds.has(t.id));

  return (
    <div className="hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-6 lg:block">
      {/* Contact card */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-600">
          <WhatsappLogo size={36} weight="fill" />
        </div>
        {editing ? (
          <div className="space-y-3 text-left">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Nama kontak"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
            />
            <input
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="Email (opsional)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
            />
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Catatan (opsional)"
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                disabled={savingContact}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                onClick={saveContact}
                disabled={savingContact}
                className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                <FloppyDisk size={14} /> Simpan
              </button>
            </div>
          </div>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-slate-900">{contact?.name ?? "Pelanggan"}</h3>
            <p className="text-sm text-slate-500">{conversation.customerPhoneDisplay}</p>
            <button
              onClick={startEdit}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <PencilSimple size={14} /> Edit Kontak
            </button>
          </>
        )}
      </div>

      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="space-y-6">
        {/* About */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Kontak</h4>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3 text-slate-600">
              <Phone size={16} className="text-slate-400" /> {conversation.customerPhoneDisplay}
            </div>
            {contact?.email && (
              <div className="flex items-center gap-3 text-slate-600">
                <EnvelopeSimple size={16} className="text-slate-400" /> {contact.email}
              </div>
            )}
            {contact?.name && (
              <div className="flex items-center gap-3 text-slate-600">
                <EnvelopeSimple size={16} className="text-slate-400" /> {contact.name}
              </div>
            )}
            {contact?.notes && (
              <div className="flex items-start gap-3 text-slate-600">
                <MapPin size={16} className="mt-0.5 text-slate-400" /> {contact.notes}
              </div>
            )}
          </div>
        </div>

        {/* Handoff */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Penanganan</h4>
          {conversation.assignee ? (
            <div className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="text-slate-900">Ditugaskan ke {conversation.assignee.name ?? conversation.assignee.email}</p>
              {assignedToMe ? (
                <button
                  disabled={busy}
                  onClick={() => patch({ assigneeUserId: null })}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <ArrowUp size={14} /> Lepas (AI kembali)
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => patch({ assigneeUserId: me })}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <Hand size={14} /> Ambil alih
                </button>
              )}
            </div>
          ) : (
            <button
              disabled={busy}
              onClick={() => patch({ assigneeUserId: me })}
              className="flex w-full items-center justify-center gap-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Hand size={16} /> Ambil alih dari AI
            </button>
          )}
        </div>

        {/* Status */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</h4>
          <div className="flex gap-1.5">
            {(["OPEN", "PENDING", "RESOLVED"] as const).map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => patch({ status: s })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                  conversation.status === s
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {s === "OPEN" ? "Aktif" : s === "PENDING" ? "Menunggu" : "Selesai"}
              </button>
            ))}
          </div>
        </div>

        {/* Tahap / Pipeline stage */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Tahap</h4>
          {stages === null ? (
            <p className="text-xs text-slate-400">Memuat tahap…</p>
          ) : stages.length === 0 ? (
            <p className="text-xs text-slate-400">Belum ada tahap.</p>
          ) : (
            <Select
              value={conversation.stage?.name ?? ""}
              onChange={(e) => setStage(e.target.value)}
              disabled={busy}
            >
              <option value="">— pilih tahap —</option>
              {stages.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        {/* Tags */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Tag</h4>
          <div className="flex flex-wrap gap-2">
            {conversation.tags.map(({ tag }) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
              >
                <TagIcon size={11} /> {tag.name}
                <button onClick={() => removeTag(tag.id)} className="hover:text-blue-900" aria-label="Hapus tag">
                  <X size={12} />
                </button>
              </span>
            ))}
            {availableTags.length > 0 && (
              <button
                onClick={() => setShowTagPicker((v) => !v)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                <Plus size={12} /> Tag
              </button>
            )}
          </div>
          {/* Inline picker: rendered in normal flow (not absolute) so the right
              panel's overflow-y-auto can't clip it, and kept open so multiple
              tags can be added in a row. Available tags recompute after each add. */}
          {showTagPicker && availableTags.length > 0 && (
            <div className="mt-2 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {availableTags.map((t) => (
                <button
                  key={t.id}
                  disabled={busy}
                  onClick={() => addTag(t.id)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <TagIcon size={11} className="text-slate-400" /> {t.name}
                </button>
              ))}
              <button
                onClick={() => setShowTagPicker(false)}
                className="mt-1 w-full rounded-md border-t border-slate-100 px-2 py-1 text-xs text-slate-400 hover:bg-slate-50"
              >
                Selesai
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
