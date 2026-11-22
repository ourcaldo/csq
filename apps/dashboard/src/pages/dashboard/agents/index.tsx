// /dashboard/agents - enterprise revamp v2 (template 2026-11-22 update):
// search + status pill filters, Saluran column (real Channel.agentId link),
// rich capability matrix (label, key, desc, Ya/Tidak, Otomatis/Wajib
// Approval), Pulihkan Default Registry, Simulator dry-run tab, and the
// create/edit form with channel select + prompt presets. No pop-ups except
// the destructive delete confirm.
import { Fragment, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { TelemetryStrip } from "@/components/dashboard/telemetry-strip";
import { FlushPage } from "@/components/dashboard/flush-page";
import { Toast } from "@/components/dashboard/channels/toast";
import type { ToastState } from "@/components/dashboard/channels/types";
import {
  capabilityMap,
  statusLabel,
  statusTone,
  type AgentWithCapabilities,
  type AgentsList,
} from "@/components/dashboard/agents/types";

// Channel row as returned by /api/dashboard/channels (sanitized view).
type ChannelView = {
  id: string;
  provider: "CLOUD_API" | "BAILEYS";
  status: string;
  label: string;
  agentId: string | null;
  phoneNumber: string | null;
};

type StatusFilter = "ALL" | "ACTIVE" | "PAUSED" | "DRAFT";

const CATEGORY_LABEL: Record<string, string> = {
  product: "Produk",
  inventory: "Inventaris",
  order: "Pesanan",
  customer: "Kontak",
  knowledge: "Pengetahuan",
  conversation: "Percakapan",
  memory: "Ingatan",
  source: "Sumber Data",
  deal: "Pipeline",
  support: "Dukungan",
};

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status === "ACTIVE" || status === "PAUSED" ? status : "DRAFT");
  const dot =
    tone === "green" ? "bg-green-500" : tone === "amber" ? "bg-amber-400" : "bg-slate-300";
  const text =
    tone === "green"
      ? "text-green-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-500";
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-medium ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {statusLabel(status === "ACTIVE" || status === "PAUSED" ? status : "DRAFT")}
    </span>
  );
}

function Switch({
  checked,
  disabled,
  amber,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  amber?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="relative inline-block h-5 w-[34px] shrink-0">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={`absolute inset-0 cursor-pointer rounded-full transition-colors peer-disabled:cursor-not-allowed peer-disabled:opacity-40 ${
          checked ? (amber ? "bg-amber-600" : "bg-green-600") : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[14px]" : ""
          }`}
        />
      </span>
    </label>
  );
}

const PRESETS: Record<string, string> = {
  cs: "Kamu adalah staf Customer Service yang ramah dan solutif. Jawab pertanyaan pelanggan berdasarkan katalog produk dan basis pengetahuan resmi. Jangan pernah menjanjikan diskon di luar daftar harga.",
  order: "Bantu pelanggan mengecek stok produk secara real-time dan catat detail pesanan (nama, nomor WhatsApp, daftar SKU, dan jumlah) ke dalam draf pesanan untuk dikonfirmasi admin.",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function AgentsPage() {
  const { data, loading, error, refresh } = useApi<AgentsList>("/api/dashboard/agents");
  const { data: channelsData } = useApi<{ items: ChannelView[] }>(
    "/api/dashboard/channels"
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");

  const [pageError, setPageError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [savingCaps, setSavingCaps] = useState<Set<string>>(new Set());

  // View state.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"matrix" | "sandbox">("matrix");
  const [sandboxOut, setSandboxOut] = useState<{ prompt: string; tool: string; verdict: string } | null>(null);

  // Form state.
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const [formChannelId, setFormChannelId] = useState("");
  const [savingForm, setSavingForm] = useState(false);

  const [toDelete, setToDelete] = useState<AgentWithCapabilities | null>(null);
  const [deleting, setDeleting] = useState(false);

  const agents = useMemo(() => data?.items ?? [], [data]);
  const tools = useMemo(() => data?.tools ?? [], [data]);
  const channels = useMemo(() => channelsData?.items ?? [], [channelsData]);
  const detail = useMemo(
    () => agents.find((a) => a.id === detailId) ?? null,
    [agents, detailId]
  );

  // Channel name for an agent (first linked channel), for the list/detail.
  const channelByAgent = useMemo(() => {
    const map = new Map<string, ChannelView>();
    for (const ch of channels) {
      if (ch.agentId && !map.has(ch.agentId)) map.set(ch.agentId, ch);
    }
    return map;
  }, [channels]);

  const groupedTools = useMemo(() => {
    const groups = new Map<string, typeof tools>();
    for (const t of tools) {
      const cat = t.category;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(t);
    }
    return Array.from(groups.entries());
  }, [tools]);

  function effCaps(agent: AgentWithCapabilities) {
    const caps = capabilityMap(agent);
    const rows = tools.map((t) => {
      const cap = caps[t.name];
      return {
        tool: t,
        cap,
        allowed: cap?.allowed ?? t.defaultPermission.allowed,
        approval: cap?.requiresApproval ?? t.defaultPermission.requiresApproval,
        isCustom: !!cap,
      };
    });
    return rows;
  }

  function showToast(msg: string) {
    setToast({ tone: "success", msg });
    setTimeout(() => setToast(null), 2500);
  }

  async function onToggleStatus(agent: AgentWithCapabilities) {
    setActioningId(agent.id);
    setPageError(null);
    try {
      if (agent.status === "ACTIVE") {
        await apiSend(`/api/dashboard/agents/${agent.id}/pause`, "POST");
        showToast(`Agent "${agent.name}" dijeda`);
      } else {
        await apiSend(`/api/dashboard/agents/${agent.id}/deploy`, "POST");
        showToast(`Agent "${agent.name}" di-deploy dan aktif`);
      }
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal mengubah status agent.");
    } finally {
      setActioningId(null);
    }
  }

  async function onCapabilityChange(
    agent: AgentWithCapabilities,
    tool: string,
    field: "allowed" | "requiresApproval",
    value: boolean
  ) {
    const caps = capabilityMap(agent);
    const current = caps[tool];
    const def = tools.find((t) => t.name === tool)?.defaultPermission;
    const nextAllowed =
      field === "allowed" ? value : current?.allowed ?? def?.allowed ?? false;
    const nextApproval =
      field === "requiresApproval"
        ? value
        : current?.requiresApproval ?? def?.requiresApproval ?? false;

    const key = `${agent.id}:${tool}`;
    setSavingCaps((prev) => new Set(prev).add(key));
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/agents/${agent.id}/capabilities`, "PUT", {
        tool,
        allowed: nextAllowed,
        requiresApproval: nextApproval,
      });
      showToast(`Izin "${tool}" diperbarui`);
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal mengubah kapabilitas.");
    } finally {
      setSavingCaps((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function onResetCaps() {
    if (!detail) return;
    setActioningId(detail.id);
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/agents/${detail.id}/capabilities`, "DELETE");
      showToast("Seluruh kapabilitas dipulihkan ke default registry");
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal memulihkan default.");
    } finally {
      setActioningId(null);
    }
  }

  function openCreate() {
    setEditingId(null);
    setFormName("");
    setFormInstructions("");
    const firstLinked = channels.find((c) => !c.agentId);
    setFormChannelId(firstLinked?.id ?? "");
    setFormOpen(true);
  }

  function openEdit(agent: AgentWithCapabilities) {
    setEditingId(agent.id);
    setFormName(agent.name);
    setFormInstructions(agent.instructions ?? "");
    const linked = channels.find((c) => c.agentId === agent.id);
    setFormChannelId(linked?.id ?? "");
    setFormOpen(true);
  }

  function applyPreset(kind: keyof typeof PRESETS) {
    setFormInstructions((prev) =>
      prev.trim() ? `${prev.trim()}\n\n${PRESETS[kind]}` : PRESETS[kind]
    );
  }

  async function onSaveForm(e: FormEvent) {
    e.preventDefault();
    setSavingForm(true);
    setPageError(null);
    try {
      const payload = {
        name: formName.trim(),
        instructions: formInstructions.trim() || null,
      };
      if (editingId) {
        await apiSend(`/api/dashboard/agents/${editingId}/edit`, "PUT", payload);
        // Channel assignment follows the form select (template 2026-11-22).
        const target = formChannelId || null;
        const current = channels.find((c) => c.agentId === editingId);
        if (current && current.id !== formChannelId) {
          await apiSend(`/api/dashboard/channels/${current.id}`, "PATCH", {
            agentId: null,
          }).catch(() => undefined);
        }
        if (target) {
          const owner = channels.find((c) => c.id === target);
          if (owner && owner.agentId !== editingId) {
            await apiSend(`/api/dashboard/channels/${target}`, "PATCH", {
              agentId: editingId,
            }).catch(() => undefined);
          }
        }
        showToast(`Persona "${formName}" diperbarui`);
      } else {
        const created = await apiSend<AgentWithCapabilities>(
          "/api/dashboard/agents",
          "POST",
          payload
        );
        if (formChannelId) {
          await apiSend(`/api/dashboard/channels/${formChannelId}`, "PATCH", {
            agentId: created.id,
          }).catch(() => undefined);
        }
        setDetailId(created.id);
        showToast(`Agent "${formName}" dibuat sebagai draf`);
      }
      setFormOpen(false);
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal menyimpan agent.");
    } finally {
      setSavingForm(false);
    }
  }

  async function onDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/agents/${toDelete.id}`, "DELETE");
      setToDelete(null);
      showToast(`Agent "${toDelete.name}" dihapus`);
      if (detailId === toDelete.id) setDetailId(null);
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal menghapus agent.");
    } finally {
      setDeleting(false);
    }
  }

  // Sandbox: honest dry-run - keyword-maps the message to a candidate tool
  // and reports what the capability matrix would decide. No LLM call.
  function runSandbox(promptText: string) {
    if (!detail) return;
    const lower = promptText.toLowerCase();
    let tool = tools.find((t) => t.name === "knowledge.search") ?? tools[0];
    if (lower.includes("stok") || lower.includes("berapa")) {
      tool = tools.find((t) => t.name === "inventory.read") ?? tool;
    } else if (lower.includes("pesan") || lower.includes("order") || lower.includes("beli")) {
      tool = tools.find((t) => t.name === "order.create") ?? tool;
    } else if (lower.includes("refund") || lower.includes("kembali")) {
      tool = tools.find((t) => t.name === "order.refund") ?? tool;
    } else if (lower.includes("komplain") || lower.includes("rusak") || lower.includes("tiket")) {
      tool = tools.find((t) => t.name === "support.create_ticket") ?? tool;
    } else if (lower.includes("harga") || lower.includes("produk")) {
      tool = tools.find((t) => t.name === "product.search") ?? tool;
    }
    const caps = capabilityMap(detail);
    const allowed = caps[tool.name]?.allowed ?? tool.defaultPermission.allowed;
    const approval =
      caps[tool.name]?.requiresApproval ?? tool.defaultPermission.requiresApproval;
    const verdict = !allowed ? "blocked" : approval ? "approval" : "auto";
    setSandboxOut({ prompt: promptText, tool: tool.name, verdict });
  }

  const counts = useMemo(() => {
    let active = 0;
    let paused = 0;
    let draft = 0;
    for (const a of agents) {
      if (a.status === "ACTIVE") active += 1;
      else if (a.status === "PAUSED") paused += 1;
      else draft += 1;
    }
    return { active, paused, draft };
  }, [agents]);

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      const matchStatus = statusFilter === "ALL" || a.status === statusFilter;
      const matchQuery =
        !q ||
        a.name.toLowerCase().includes(q) ||
        (a.instructions ?? "").toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });
  }, [agents, statusFilter, search]);

  const statusPills: { key: StatusFilter; label: string }[] = [
    { key: "ALL", label: "Semua" },
    { key: "ACTIVE", label: "Aktif" },
    { key: "PAUSED", label: "Dijeda" },
    { key: "DRAFT", label: "Draf" },
  ];

  // ─── View 3: full-page create/edit form ───
  if (formOpen) {
    return (
      <DashboardShell title={editingId ? "Edit Agent" : "Buat Agent"} flush>
        <FlushPage>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <ArrowLeft size={12} />Agent
                </button>
                <span className="text-slate-300">/</span>
                <span className="font-medium text-slate-700">
                  {editingId ? `Edit - ${formName}` : "Buat Agent"}
                </span>
              </div>
              <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
                {editingId ? `Edit Persona - ${formName}` : "Buat Agent Baru"}
              </h1>
              <p className="mt-2 text-xs text-slate-500">
                {editingId
                  ? "Perubahan instruksi sistem dan saluran langsung berlaku pada percakapan aktif."
                  : "Agent baru dibuat sebagai draf. Deploy untuk mengaktifkannya pada saluran pelanggan."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
          </div>

          <form onSubmit={onSaveForm} className="divide-y divide-slate-200">
            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Identitas &amp; Saluran</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Nama tampilan agent di dashboard, audit log, dan saluran WhatsApp yang ditugaskan.
                </p>
              </div>
              <div className="max-w-lg space-y-3.5 md:col-span-8">
                <div>
                  <label htmlFor="af-name" className="block text-xs font-medium text-slate-700">
                    Nama Agent <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="af-name"
                    type="text"
                    required
                    placeholder="mis. CS Utama Toko Kopi"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  />
                </div>
                <div>
                  <label htmlFor="af-channel" className="block text-xs font-medium text-slate-700">
                    Saluran Terhubung
                  </label>
                  <select
                    id="af-channel"
                    value={formChannelId}
                    onChange={(e) => setFormChannelId(e.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-green-600 focus:outline-none"
                  >
                    <option value="">Belum ditugaskan</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label || c.phoneNumber || c.id.slice(0, 8)} ({c.provider === "CLOUD_API" ? "Cloud API" : "Baileys"})
                        {c.agentId && c.agentId !== editingId ? " (sudah dipakai agent lain)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Persona &amp; Instruksi Sistem</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Gaya bahasa, batasan kebijakan, dan panduan eskalasi ke staf manusia.
                </p>
                <div className="mt-3 space-y-1.5">
                  <p className="text-[11px] font-medium text-slate-400">Sisipkan Template Cepat:</p>
                  <button
                    type="button"
                    onClick={() => applyPreset("cs")}
                    className="block rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    + Customer Service &amp; Katalog
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("order")}
                    className="block rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    + Asisten Pemesanan &amp; Stok
                  </button>
                </div>
              </div>
              <div className="max-w-2xl md:col-span-8">
                <div className="flex items-center justify-between">
                  <label htmlFor="af-instructions" className="block text-xs font-medium text-slate-700">
                    System Prompt <span className="text-red-500">*</span>
                  </label>
                  <span className="font-mono text-[11px] text-slate-400">
                    {formInstructions.length} karakter
                  </span>
                </div>
                <textarea
                  id="af-instructions"
                  rows={7}
                  required
                  value={formInstructions}
                  onChange={(e) => setFormInstructions(e.target.value)}
                  placeholder="Tuliskan peran, nada bicara, dan aturan operasional agent…"
                  className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                />
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Guardrail keamanan CSQ aktif secara otomatis untuk mencegah kebocoran prompt internal dan halusinasi harga.
                </p>
              </div>
            </div>

            {pageError && <p className="pb-2 text-xs text-red-600">{pageError}</p>}

            <div className="flex items-center justify-end gap-2.5 pt-5">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingForm || !formName.trim() || !formInstructions.trim()}
                className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {savingForm
                  ? "Menyimpan…"
                  : editingId
                    ? "Simpan Perubahan"
                    : "Simpan sebagai Draf"}
              </button>
            </div>
          </form>
        </FlushPage>
      </DashboardShell>
    );
  }

  // ─── View 2: full-page detail ───
  if (detail) {
    const rows = effCaps(detail);
    const allowedCount = rows.filter((r) => r.allowed).length;
    const approvalCount = rows.filter((r) => r.allowed && r.approval).length;
    const overrideCount = rows.filter((r) => r.isCustom).length;
    const linkedChannel = channelByAgent.get(detail.id);
    return (
      <DashboardShell title={detail.name} flush>
        <FlushPage>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => setDetailId(null)}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <ArrowLeft size={12} />Agent
                </button>
                <span className="text-slate-300">/</span>
                <span className="font-medium text-slate-700">{detail.name}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xl font-semibold tracking-tight text-slate-900">
                {detail.name} <StatusPill status={detail.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-slate-400">
                <span>ID: {detail.id.slice(0, 8)}</span>
                <span>Saluran: {linkedChannel ? linkedChannel.label || linkedChannel.phoneNumber || "-" : "Belum ditugaskan"}</span>
                <span>Dibuat: {formatDate(detail.createdAt)}</span>
                <span>Diperbarui: {formatDate(detail.updatedAt)}</span>
              </div>
              <p className="mt-3 max-w-3xl text-xs leading-relaxed text-slate-600">
                {detail.instructions ??
                  "Belum ada instruksi - agent akan menjawab tanpa persona khusus."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openEdit(detail)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <PencilSimple size={12} />Edit Persona
              </button>
              <button
                type="button"
                disabled={actioningId === detail.id}
                onClick={() => void onToggleStatus(detail)}
                className={
                  detail.status === "ACTIVE"
                    ? "inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                    : "inline-flex h-8 items-center gap-1.5 rounded-md bg-green-600 px-3 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                }
              >
                {detail.status === "ACTIVE" ? (
                  <>
                    <Pause size={12} />Jeda Agent
                  </>
                ) : (
                  <>
                    <Play size={12} />Deploy Agent
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setToDelete(detail)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                <Trash size={12} />Hapus
              </button>
            </div>
          </div>

          {pageError && (
            <p className="mt-5 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700">
              {pageError}
            </p>
          )}

          <TelemetryStrip
            cells={[
              { label: "Total Alat Registry", value: String(rows.length) },
              { label: "Diizinkan", value: String(allowedCount), valueClass: "text-green-700" },
              { label: "Butuh Approval", value: String(approvalCount), valueClass: "text-amber-600" },
              { label: "Override Kustom", value: String(overrideCount) },
            ]}
          />

          {/* Detail sub-tabs */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
            <div className="flex gap-6">
              <button
                type="button"
                onClick={() => setDetailTab("matrix")}
                className={
                  detailTab === "matrix"
                    ? "relative py-2.5 text-xs font-semibold text-slate-900 after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-green-600"
                    : "relative py-2.5 text-xs font-medium text-slate-500 hover:text-slate-900"
                }
              >
                Matriks Kapabilitas Alat
              </button>
              <button
                type="button"
                onClick={() => setDetailTab("sandbox")}
                className={
                  detailTab === "sandbox"
                    ? "relative py-2.5 text-xs font-semibold text-slate-900 after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-green-600"
                    : "relative py-2.5 text-xs font-medium text-slate-500 hover:text-slate-900"
                }
              >
                Simulator &amp; Uji Prompt
              </button>
            </div>
            {overrideCount > 0 && detailTab === "matrix" && (
              <button
                type="button"
                disabled={actioningId === detail.id}
                onClick={() => void onResetCaps()}
                className="pb-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50"
              >
                <ArrowCounterClockwise size={12} className="mr-1 inline" />
                Pulihkan Default Registry
              </button>
            )}
          </div>

          {detailTab === "matrix" && (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkle size={14} weight="fill" className="text-green-600" />
                  <h2 className="text-sm font-semibold text-slate-900">Izin Eksekusi per Alat</h2>
                  <span className="font-mono text-[11px] text-slate-400">
                    Perubahan diterapkan real-time pada turn berikutnya
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-green-500" />Eksekusi Langsung
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />Antrean Approval Manusia
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto border-y border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">Alat &amp; Deskripsi</th>
                      <th className="w-36 px-4 py-3">Diizinkan</th>
                      <th className="w-44 px-4 py-3">Butuh Approval</th>
                      <th className="hidden px-4 py-3 sm:table-cell">Default Registry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {rows.map(({ tool, allowed, approval, isCustom }) => (
                      <tr key={tool.name} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900">
                              {CATEGORY_LABEL[tool.category] ?? tool.category}
                            </span>
                            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                              {tool.name}
                            </span>
                            {isCustom && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-700">
                                Override
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">{tool.description}</p>
                        </td>
                        <td className="px-4 py-3.5">
                          <label className="inline-flex items-center gap-2.5">
                            <Switch
                              label={`Diizinkan ${tool.name}`}
                              checked={allowed}
                              disabled={savingCaps.has(`${detail.id}:${tool.name}`)}
                              onChange={(v) => void onCapabilityChange(detail, tool.name, "allowed", v)}
                            />
                            <span
                              className={`font-mono text-[11px] ${allowed ? "font-semibold text-green-700" : "text-slate-400"}`}
                            >
                              {allowed ? "Ya" : "Tidak"}
                            </span>
                          </label>
                        </td>
                        <td className="px-4 py-3.5">
                          <label className="inline-flex items-center gap-2.5">
                            <Switch
                              amber
                              label={`Butuh approval ${tool.name}`}
                              checked={approval}
                              disabled={!allowed || savingCaps.has(`${detail.id}:${tool.name}`)}
                              onChange={(v) =>
                                void onCapabilityChange(detail, tool.name, "requiresApproval", v)
                              }
                            />
                            <span
                              className={`font-mono text-[11px] ${!allowed ? "text-slate-300" : approval ? "font-semibold text-amber-700" : "text-slate-500"}`}
                            >
                              {!allowed ? "Nonaktif" : approval ? "Wajib Approval" : "Otomatis"}
                            </span>
                          </label>
                        </td>
                        <td className="hidden px-4 py-3.5 font-mono text-[11px] text-slate-500 sm:table-cell">
                          {tool.defaultPermission.allowed
                            ? tool.defaultPermission.requiresApproval
                              ? "Diizinkan - Approval"
                              : "Diizinkan - Otomatis"
                            : "Diblokir"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detailTab === "sandbox" && (
            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Uji Skenario Percakapan
                </h3>
                <p className="text-xs leading-relaxed text-slate-500">
                  Simulasikan pesan pelanggan untuk memverifikasi alat mana yang akan dipanggil
                  oleh agent beserta status approval-nya.
                </p>
                <div className="space-y-1.5 pt-1">
                  {[
                    "Halo, stok Kopi Gayo 250g masih ada berapa ya?",
                    "Tolong buatkan pesanan 2 bungkus Kopi Gayo 250g atas nama Budi",
                    "Saya mau komplain paket rusak, tolong refund dana saya",
                  ].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => runSandbox(p)}
                      className="block w-full rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100"
                    >
                      &quot;{p}&quot;
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const el = e.currentTarget.querySelector("input");
                    if (el && el.value.trim()) {
                      runSandbox(el.value.trim());
                      el.value = "";
                    }
                  }}
                  className="pt-2"
                >
                  <label className="block text-xs font-medium text-slate-700">Pesan Kustom</label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      type="text"
                      placeholder="Ketik pesan simulasi…"
                      className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-green-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="h-9 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white hover:bg-green-700"
                    >
                      Uji
                    </button>
                  </div>
                </form>
              </div>

              <div className="lg:col-span-7">
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                    <span className="font-mono text-[11px] font-semibold uppercase text-slate-500">
                      Execution Trace Preview
                    </span>
                    <span className="font-mono text-[11px] text-green-700">Dry-Run (0 Kredit)</span>
                  </div>
                  <div className="mt-3 space-y-3 text-xs text-slate-600">
                    {!sandboxOut && (
                      <p className="py-6 text-center text-slate-400">
                        Pilih contoh pesan di sebelah kiri atau ketik pesan baru untuk melihat
                        jejak pemanggilan alat.
                      </p>
                    )}
                    {sandboxOut && (
                      <>
                        <div className="rounded border border-slate-200 bg-white p-3">
                          <p className="font-mono text-[10px] uppercase text-slate-400">
                            Input Pelanggan
                          </p>
                          <p className="mt-1 font-medium text-slate-900">&quot;{sandboxOut.prompt}&quot;</p>
                        </div>
                        <div className="rounded border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] uppercase text-slate-400">
                              Kandidat Alat
                            </span>
                            <span className="font-mono text-[11px] font-semibold text-slate-800">
                              {sandboxOut.tool}
                            </span>
                          </div>
                          <div className="mt-2">
                            {sandboxOut.verdict === "blocked" && (
                              <>
                                <span className="rounded bg-red-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-red-700">
                                  DIBLOKIR OLEH MATRIKS IZIN
                                </span>
                                <p className="mt-1.5 text-slate-600">
                                  Agent dilarang memanggil{" "}
                                  <code className="font-mono">{sandboxOut.tool}</code>. Agent akan
                                  menjawab secara sopan bahwa tindakan tersebut memerlukan bantuan
                                  staf.
                                </p>
                              </>
                            )}
                            {sandboxOut.verdict === "approval" && (
                              <>
                                <span className="rounded bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-700">
                                  DIALIHKAN KE ANTREAN APPROVAL
                                </span>
                                <p className="mt-1.5 text-slate-600">
                                  Agent menyusun payload untuk{" "}
                                  <code className="font-mono">{sandboxOut.tool}</code> dan menahan
                                  eksekusi hingga Owner/Staff menyetujui di menu{" "}
                                  <strong>Approval</strong>.
                                </p>
                              </>
                            )}
                            {sandboxOut.verdict === "auto" && (
                              <>
                                <span className="rounded bg-green-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-green-700">
                                  EKSEKUSI OTOMATIS DIIZINKAN
                                </span>
                                <p className="mt-1.5 text-slate-600">
                                  Agent langsung mengeksekusi{" "}
                                  <code className="font-mono">{sandboxOut.tool}</code> dan menyusun
                                  balasan terverifikasi.
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </FlushPage>
        <Toast toast={toast} />
      </DashboardShell>
    );
  }

  // ─── View 1: list ───
  return (
    <DashboardShell title="Agent" flush>
      <FlushPage>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Agent</h1>
            <p className="mt-1 text-xs text-slate-500">
              Kelola agent AI: status deploy, saluran terhubung, dan matriks izin per alat.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
          >
            <Plus size={14} />Buat Agent
          </button>
        </div>

        <TelemetryStrip
          cells={[
            { label: "Total Agent", value: String(agents.length) },
            { label: "Aktif (Deployed)", value: String(counts.active), valueClass: "text-green-700" },
            { label: "Dijeda", value: String(counts.paused), valueClass: "text-amber-600" },
            { label: "Draf", value: String(counts.draft) },
          ]}
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Filter nama atau instruksi…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-60 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder-slate-400 focus:border-green-600 focus:outline-none"
            />
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
              {statusPills.map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setStatusFilter(pill.key)}
                  className={
                    statusFilter === pill.key
                      ? "rounded bg-white px-2.5 py-1 font-semibold text-slate-900 shadow-sm"
                      : "rounded px-2.5 py-1 font-medium text-slate-600 hover:text-slate-900"
                  }
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>
          <span className="font-mono text-[11px] text-slate-400">
            Registry: {tools.length} Tools
          </span>
        </div>

        {pageError && (
          <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700">
            {pageError}
          </p>
        )}
        {loading && <StateNotice variant="loading" message="Memuat agent…" className="mt-4" />}
        {error && <StateNotice variant="error" message={error} className="mt-4" />}
        {!loading && !error && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3 pr-4">Agent</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="hidden px-4 py-3 md:table-cell">Alat Diizinkan</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Saluran</th>
                  <th className="hidden px-4 py-3 xl:table-cell">Diperbarui</th>
                  <th className="py-3 pl-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                {filteredAgents.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                      Tidak ada agent yang cocok dengan kriteria filter.
                    </td>
                  </tr>
                )}
                {filteredAgents.map((a) => {
                  const caps = effCaps(a);
                  const linked = channelByAgent.get(a.id);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/80">
                      <td className="py-3.5 pr-4">
                        <button
                          type="button"
                          onClick={() => {
                            setDetailId(a.id);
                            setDetailTab("matrix");
                            setSandboxOut(null);
                          }}
                          className="text-left text-xs font-semibold text-slate-900 hover:text-green-700"
                        >
                          {a.name}
                        </button>
                        {a.instructions ? (
                          <p className="mt-0.5 line-clamp-1 max-w-md text-[11px] text-slate-500">
                            {a.instructions}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[11px] italic text-slate-400">
                            Belum ada instruksi.
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusPill status={a.status} />
                      </td>
                      <td className="hidden px-4 py-3.5 md:table-cell">
                        <span className="font-mono text-xs font-semibold tabular-nums text-slate-900">
                          {caps.filter((r) => r.allowed).length}
                        </span>
                        <span className="font-mono text-xs text-slate-400">
                          {" "}/ {tools.length} alat
                        </span>
                      </td>
                      <td className="hidden px-4 py-3.5 lg:table-cell">
                        {linked ? (
                          <>
                            <p className="text-xs text-slate-700">
                              {linked.label || linked.phoneNumber || "Saluran"}
                            </p>
                            <p className="font-mono text-[10px] text-slate-400">
                              {linked.provider === "CLOUD_API" ? "Cloud API" : "Baileys"}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs italic text-slate-400">Belum ditugaskan</p>
                        )}
                      </td>
                      <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-500 xl:table-cell">
                        {formatDate(a.updatedAt)}
                      </td>
                      <td className="py-3.5 pl-4 text-right">
                        <div className="inline-flex items-center gap-2.5">
                          <button
                            type="button"
                            disabled={actioningId === a.id}
                            onClick={() => void onToggleStatus(a)}
                            className={
                              a.status === "ACTIVE"
                                ? "rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                                : "rounded border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 transition hover:bg-green-100 disabled:opacity-50"
                            }
                          >
                            {a.status === "ACTIVE" ? "Jeda" : "Deploy"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDetailId(a.id);
                              setDetailTab("matrix");
                              setSandboxOut(null);
                            }}
                            className="text-xs font-semibold text-green-700 hover:underline"
                          >
                            Matriks &amp; Detail
                          </button>
                          <button
                            type="button"
                            onClick={() => setToDelete(a)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </FlushPage>

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Agent AI"
        description={`Apakah Anda yakin ingin menghapus agent "${toDelete?.name ?? ""}" beserta konfigurasi matriks kapabilitasnya secara permanen?`}
        confirmLabel="Hapus Permanen"
        destructive
        loading={deleting}
        onConfirm={() => void onDelete()}
        onCancel={() => setToDelete(null)}
      />
      <Toast toast={toast} />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} }),
  // SEC-3 (PRD 16): configuration pages are OWNER-only (PRD 15.9).
  { requiredRole: "OWNER" }
);
