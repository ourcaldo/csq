// /dashboard/agents - enterprise revamp (template 2026-11-22, agent_csq_
// enterprise.html): telemetry strip, agent table, FULL-PAGE detail with the
// capability matrix, and a FULL-PAGE persona form. Pop-ups removed except
// the destructive delete confirm.
import { Fragment, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Robot,
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
  TOOL_GROUPS,
  type AgentWithCapabilities,
  type AgentsList,
} from "@/components/dashboard/agents/types";

const TOTAL_TOOLS = TOOL_GROUPS.reduce((s, g) => s + g.tools.length, 0);

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(
    status === "ACTIVE" || status === "PAUSED" ? status : "DRAFT"
  );
  const dot =
    tone === "green" ? "bg-green-500" : tone === "amber" ? "bg-amber-400" : "bg-slate-300";
  const text =
    tone === "green"
      ? "text-green-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-500";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {statusLabel(status === "ACTIVE" || status === "PAUSED" ? status : "DRAFT")}
    </span>
  );
}

function AgentTile({ status }: { status: string }) {
  const bg =
    status === "ACTIVE"
      ? "bg-green-600"
      : status === "PAUSED"
        ? "bg-amber-500"
        : "bg-slate-300";
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bg} text-white`}
    >
      <Robot size={18} weight="fill" />
    </span>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="relative inline-block h-5 w-9 shrink-0">
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
        className={`absolute inset-0 cursor-pointer rounded-full transition-colors peer-disabled:cursor-not-allowed peer-disabled:opacity-45 ${
          checked ? "bg-green-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
    </label>
  );
}

export default function AgentsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data, loading, error, refresh } = useApi<AgentsList>("/api/dashboard/agents");

  const [pageError, setPageError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [savingCaps, setSavingCaps] = useState<Set<string>>(new Set());

  // View state: null = list, {id} = detail, true = persona form.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const [savingForm, setSavingForm] = useState(false);

  const [toDelete, setToDelete] = useState<AgentWithCapabilities | null>(null);
  const [deleting, setDeleting] = useState(false);

  const agents = useMemo(() => data?.items ?? [], [data]);
  const detail = useMemo(
    () => agents.find((a) => a.id === detailId) ?? null,
    [agents, detailId]
  );
  const defaults = useMemo(
    () => new Map((data?.tools ?? []).map((t) => [t.name, t])),
    [data]
  );

  function showToast(msg: string) {
    setToast({ tone: "success", msg });
    setTimeout(() => setToast(null), 2600);
  }

  async function onToggleStatus(agent: AgentWithCapabilities) {
    setActioningId(agent.id);
    setPageError(null);
    try {
      if (agent.status === "ACTIVE") {
        await apiSend(`/api/dashboard/agents/${agent.id}/pause`, "POST");
        showToast(`Agent "${agent.name}" dijeda - tidak membalas percakapan baru`);
      } else {
        await apiSend(`/api/dashboard/agents/${agent.id}/deploy`, "POST");
        showToast(`Agent "${agent.name}" berhasil di-deploy dan aktif`);
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
    const def = defaults.get(tool);
    const nextAllowed =
      field === "allowed" ? value : current?.allowed ?? def?.defaultPermission.allowed ?? false;
    const nextApproval =
      field === "requiresApproval"
        ? value
        : current?.requiresApproval ?? def?.defaultPermission.requiresApproval ?? false;

    const key = `${agent.id}:${tool}`;
    setSavingCaps((prev) => new Set(prev).add(key));
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/agents/${agent.id}/capabilities`, "PUT", {
        tool,
        allowed: nextAllowed,
        requiresApproval: nextApproval,
      });
      showToast(`Kapabilitas ${tool} diperbarui`);
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

  function openCreate() {
    setEditingId(null);
    setFormName("");
    setFormInstructions("");
    setFormOpen(true);
  }

  function openEdit(agent: AgentWithCapabilities) {
    setEditingId(agent.id);
    setFormName(agent.name);
    setFormInstructions(agent.instructions ?? "");
    setFormOpen(true);
  }

  async function onSaveForm() {
    setSavingForm(true);
    setPageError(null);
    try {
      const payload = {
        name: formName.trim(),
        instructions: formInstructions.trim() || null,
      };
      if (editingId) {
        await apiSend(`/api/dashboard/agents/${editingId}/edit`, "PUT", payload);
        showToast(`Perubahan pada "${formName}" disimpan`);
      } else {
        const created = await apiSend<AgentWithCapabilities>(
          "/api/dashboard/agents",
          "POST",
          payload
        );
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

  function allowedCount(agent: AgentWithCapabilities): number {
    let n = 0;
    for (const g of TOOL_GROUPS) {
      for (const tool of g.tools) {
        const cap = capabilityMap(agent)[tool];
        if (cap?.allowed ?? defaults.get(tool)?.defaultPermission.allowed ?? false) n += 1;
      }
    }
    return n;
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

  // ─── Full-page persona form view ───
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
                  {editingId ? "Edit Persona" : "Buat Agent"}
                </span>
              </div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                {editingId ? `Edit Agent - ${formName}` : "Buat Agent Baru"}
              </h1>
              <p className="mt-2 text-xs text-slate-500">
                {editingId
                  ? "Ubah nama dan instruksi (persona) agent."
                  : "Agent baru dibuat sebagai draf. Deploy untuk mengaktifkannya."}
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onSaveForm();
            }}
            className="divide-y divide-slate-200"
          >
            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Identitas Agent</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Nama tampilan agent di dashboard dan audit log.
                </p>
              </div>
              <div className="md:col-span-8">
                <label htmlFor="af-name" className="block text-xs font-medium text-slate-700">
                  Nama Agent <span className="text-red-500">*</span>
                </label>
                <input
                  id="af-name"
                  type="text"
                  required
                  maxLength={100}
                  placeholder="mis. Customer Service Utama"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-1.5 h-9 w-full max-w-md rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
              <div className="md:col-span-4">
                <span className="text-xs font-semibold text-slate-900">Instruksi (Persona)</span>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Instruksi ini menjadi system prompt agent pada setiap percakapan. Jaga agar
                  ringkas dan spesifik - pengetahuan produk diambil agent lewat alat pencarian,
                  bukan lewat prompt.
                </p>
              </div>
              <div className="md:col-span-8">
                <textarea
                  id="af-instructions"
                  rows={7}
                  placeholder="Kamu adalah customer service Toko Kopi Nusantara. Jawab dengan ramah dalam Bahasa Indonesia..."
                  value={formInstructions}
                  onChange={(e) => setFormInstructions(e.target.value)}
                  className="w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                />
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Tipe agent: Customer Service. Tipe khusus lain (Sales, Inventaris) dapat
                  ditambahkan kemudian.
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
                disabled={savingForm || !formName.trim()}
                className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {savingForm ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Buat Agent"}
              </button>
            </div>
          </form>
        </FlushPage>
      </DashboardShell>
    );
  }

  // ─── Full-page detail view ───
  if (detail) {
    const caps = capabilityMap(detail);
    const allowedTools = TOOL_GROUPS.flatMap((g) => g.tools).filter(
      (tool) =>
        caps[tool]?.allowed ?? defaults.get(tool)?.defaultPermission.allowed ?? false
    );
    const approvalTools = TOOL_GROUPS.flatMap((g) => g.tools).filter(
      (tool) =>
        caps[tool]?.requiresApproval ??
        defaults.get(tool)?.defaultPermission.requiresApproval ??
        false
    );
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
              <h1 className="mt-4 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-slate-900">
                <AgentTile status={detail.status} />
                {detail.name} <StatusBadge status={detail.status} />
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-slate-400">
                <span>
                  ID: {detail.id.slice(0, 8)}
                </span>
                <span>
                  Dibuat:{" "}
                  {new Date(detail.createdAt).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span>
                  Diperbarui:{" "}
                  {new Date(detail.updatedAt).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <p className="mt-3 max-w-3xl text-xs leading-relaxed text-slate-500">
                {detail.instructions ??
                  "Belum ada instruksi - agent akan menjawab tanpa persona khusus."}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isOwner && (
                <>
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
                        ? "inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-500 px-3 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
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
                </>
              )}
            </div>
          </div>

          {pageError && (
            <p className="mt-5 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700">
              {pageError}
            </p>
          )}

          {/* Capability summary strip */}
          <div className="mt-6 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-slate-200">
            <div className="py-3.5 pr-4">
              <p className="text-[11px] font-medium text-slate-400">Total Alat Registry</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{TOTAL_TOOLS}</p>
            </div>
            <div className="py-3.5 sm:px-5">
              <p className="text-[11px] font-medium text-slate-400">Diizinkan</p>
              <p className="mt-1 font-mono text-lg font-semibold text-green-700">
                {allowedTools.length}
              </p>
            </div>
            <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-5">
              <p className="text-[11px] font-medium text-slate-400">Butuh Approval</p>
              <p className="mt-1 font-mono text-lg font-semibold text-amber-600">
                {approvalTools.length}
              </p>
            </div>
            <div className="border-t border-slate-200 py-3.5 sm:border-t-0 sm:pl-5">
              <p className="text-[11px] font-medium text-slate-400">Override Kustom</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">
                {Object.keys(caps).length}
              </p>
            </div>
          </div>

          <div className="mt-8">
            <div className="mb-3 flex items-center gap-2">
              <Sparkle size={14} weight="fill" className="text-green-600" />
              <h2 className="text-sm font-semibold text-slate-900">Kapabilitas Alat</h2>
              <span className="font-mono text-[11px] text-slate-400">
                Izin per alat - diubah langsung dari matriks
              </span>
            </div>
            <div className="overflow-x-auto border-y border-slate-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Alat</th>
                    <th className="w-40 px-4 py-3">Diizinkan</th>
                    <th className="w-48 px-4 py-3">Butuh Approval</th>
                    <th className="hidden px-4 py-3 sm:table-cell">Default Registry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {TOOL_GROUPS.map((group, gi) => (
                    <Fragment key={group.label}>
                      {gi > 0 && (
                        <tr>
                          <td colSpan={4} className="bg-slate-50/60 px-4 py-1.5">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                              {group.label}
                            </span>
                          </td>
                        </tr>
                      )}
                      {group.tools.map((tool) => {
                        const cap = caps[tool];
                        const def = defaults.get(tool);
                        const allowed =
                          cap?.allowed ?? def?.defaultPermission.allowed ?? false;
                        const requiresApproval =
                          cap?.requiresApproval ??
                          def?.defaultPermission.requiresApproval ??
                          false;
                        const saving = savingCaps.has(`${detail.id}:${tool}`);
                        return (
                          <tr key={tool} className="hover:bg-slate-50/60">
                            <td className="px-4 py-3 font-mono text-xs text-slate-800">
                              {tool}
                            </td>
                            <td className="px-4 py-3">
                              <Toggle
                                label={`Diizinkan ${tool}`}
                                checked={allowed}
                                disabled={!isOwner || saving}
                                onChange={(v) =>
                                  void onCapabilityChange(detail, tool, "allowed", v)
                                }
                              />
                            </td>
                            <td className="px-4 py-3">
                              <Toggle
                                label={`Butuh approval ${tool}`}
                                checked={requiresApproval}
                                disabled={!isOwner || saving || !allowed}
                                onChange={(v) =>
                                  void onCapabilityChange(detail, tool, "requiresApproval", v)
                                }
                              />
                            </td>
                            <td className="hidden px-4 py-3 sm:table-cell">
                              <span
                                className={`font-mono text-[11px] ${cap ? "text-green-700" : "text-slate-400"}`}
                              >
                                {cap ? "override" : "default"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {!isOwner && (
              <p className="mt-3 text-xs text-slate-400">
                Kapabilitas hanya dapat diubah oleh owner.
              </p>
            )}
          </div>
        </FlushPage>
        <Toast toast={toast} />
      </DashboardShell>
    );
  }

  // ─── List view ───
  return (
    <DashboardShell title="Agent" flush>
      <FlushPage>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Agent</h1>
            <p className="mt-1 text-xs text-slate-500">
              Kelola agent AI: status deploy dan kapabilitas per alat. Buka detail agent untuk
              matriks izin lengkap.
            </p>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
            >
              <Plus size={14} />Buat Agent
            </button>
          )}
        </div>

        <TelemetryStrip
          cells={[
            { label: "Total Agent", value: String(agents.length) },
            { label: "Aktif", value: String(counts.active), valueClass: "text-green-700" },
            { label: "Dijeda", value: String(counts.paused), valueClass: "text-amber-600" },
            { label: "Draf", value: String(counts.draft) },
          ]}
        />

        {pageError && (
          <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-700">
            {pageError}
          </p>
        )}
        {!isOwner && (
          <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700">
            Hanya owner yang dapat men-deploy agent atau mengubah kapabilitas. Anda dapat melihat
            dalam mode baca-saja.
          </p>
        )}

        {loading && <StateNotice variant="loading" message="Memuat agent…" className="mt-5" />}
        {error && <StateNotice variant="error" message={error} className="mt-5" />}
        {!loading && !error && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3 pr-4">Agent</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="hidden px-4 py-3 md:table-cell">Alat Diizinkan</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Diperbarui</th>
                  <th className="py-3 pl-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-xs text-slate-400">
                      Belum ada agent. Klik &quot;Buat Agent&quot; untuk menambahkan.
                    </td>
                  </tr>
                )}
                {agents.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/80">
                    <td className="py-3.5 pr-4">
                      <div className="flex items-start gap-3">
                        <AgentTile status={a.status} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900">{a.name}</p>
                          {a.instructions ? (
                            <p className="mt-0.5 line-clamp-1 max-w-md text-[11px] text-slate-500">
                              {a.instructions}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-[11px] italic text-slate-400">
                              Belum ada instruksi.
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="hidden px-4 py-3.5 md:table-cell">
                      <span className="font-mono text-xs tabular-nums text-slate-700">
                        {allowedCount(a)}/{TOTAL_TOOLS} alat
                      </span>
                    </td>
                    <td className="hidden px-4 py-3.5 font-mono text-xs text-slate-500 lg:table-cell">
                      {new Date(a.updatedAt).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="py-3.5 pl-4 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setDetailId(a.id)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Detail
                        </button>
                        {isOwner && (
                          <>
                            <button
                              type="button"
                              disabled={actioningId === a.id}
                              onClick={() => void onToggleStatus(a)}
                              className={
                                a.status === "ACTIVE"
                                  ? "text-xs font-medium text-amber-700 hover:underline disabled:opacity-50"
                                  : "text-xs font-semibold text-green-700 hover:underline disabled:opacity-50"
                              }
                            >
                              {a.status === "ACTIVE" ? "Jeda" : "Deploy"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setToDelete(a)}
                              className="text-xs font-medium text-red-600 hover:underline"
                            >
                              Hapus
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FlushPage>

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Agent"
        description={`Yakin ingin menghapus agent "${toDelete?.name ?? ""}"? Kapabilitas dan memorinya ikut terhapus. Tindakan ini tidak dapat dibatalkan.`}
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
