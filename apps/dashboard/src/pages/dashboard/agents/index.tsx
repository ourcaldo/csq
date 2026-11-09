import { useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { Plus, Robot } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { Button } from "@csq/ui/components/ui/button";
import { AgentKpiRow } from "@/components/dashboard/agents/agent-kpi-row";
import { AgentCard } from "@/components/dashboard/agents/agent-card";
import { AgentDialog } from "@/components/dashboard/agents/agent-dialog";
import {
  capabilityMap,
  type AgentsList,
  type AgentWithCapabilities,
} from "@/components/dashboard/agents/types";

export default function AgentsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data, loading, error, refresh } = useApi<AgentsList>("/api/dashboard/agents");

  // Track which (agentId, tool) pairs are mid-save so we can disable just
  // those toggles. A Set of `${agentId}:${tool}` strings.
  const [savingCaps, setSavingCaps] = useState<Set<string>>(new Set());
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Persona edit dialog state (gap C).
  const [editing, setEditing] = useState<AgentWithCapabilities | null>(null);
  const [editName, setEditName] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Create-agent dialog state (PRD §15.2/§19).
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createInstructions, setCreateInstructions] = useState("");
  const [savingCreate, setSavingCreate] = useState(false);

  const agents = useMemo(() => data?.items ?? [], [data]);

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

  async function onDeploy(agent: AgentWithCapabilities) {
    setActioningId(agent.id);
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/agents/${agent.id}/deploy`, "POST");
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal men-deploy agent.");
    } finally {
      setActioningId(null);
    }
  }

  async function onPause(agent: AgentWithCapabilities) {
    setActioningId(agent.id);
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/agents/${agent.id}/pause`, "POST");
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal menjeda agent.");
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
    // Compute the next override state from the current override (or defaults
    // of false when no override exists yet) so both switches stay consistent.
    const caps = capabilityMap(agent);
    const current = caps[tool];
    const nextAllowed = field === "allowed" ? value : current?.allowed ?? false;
    const nextApproval =
      field === "requiresApproval" ? value : current?.requiresApproval ?? false;

    const key = `${agent.id}:${tool}`;
    setSavingCaps((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/agents/${agent.id}/capabilities`, "PUT", {
        tool,
        allowed: nextAllowed,
        requiresApproval: nextApproval,
      });
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

  function openEdit(agent: AgentWithCapabilities) {
    setEditing(agent);
    setEditName(agent.name);
    setEditInstructions(agent.instructions ?? "");
  }

  async function onSaveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/agents/${editing.id}/edit`, "PUT", {
        name: editName.trim(),
        instructions: editInstructions.trim() || null,
      });
      setEditing(null);
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal menyimpan agent.");
    } finally {
      setSavingEdit(false);
    }
  }

  function openCreate() {
    setCreateName("");
    setCreateInstructions("");
    setCreating(true);
  }

  async function onSaveCreate() {
    setSavingCreate(true);
    setPageError(null);
    try {
      await apiSend("/api/dashboard/agents", "POST", {
        name: createName.trim(),
        instructions: createInstructions.trim() || null,
      });
      setCreating(false);
      refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Gagal membuat agent.");
    } finally {
      setSavingCreate(false);
    }
  }

  return (
    <DashboardShell
      title="Agent"
      description="Kelola agent AI: status deploy dan kapabilitas per alat."
      actions={
        isOwner ? (
          <Button size="sm" onClick={openCreate}>
            <Plus size={16} />
            Buat Agent
          </Button>
        ) : undefined
      }
    >
      {pageError && (
        <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
          {pageError}
        </p>
      )}

      {!isOwner && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Hanya owner yang dapat men-deploy agent atau mengubah kapabilitas. Anda
          dapat melihat dalam mode baca-saja.
        </p>
      )}

      {/* KPI row */}
      {!loading && !error && agents.length > 0 && (
        <div className="space-y-6">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isOwner={isOwner}
              actioningId={actioningId}
              savingCaps={savingCaps}
              toolDefaults={data?.tools ?? []}
              onEdit={openEdit}
              onPause={onPause}
              onDeploy={onDeploy}
              onCapabilityChange={onCapabilityChange}
            />
          ))}
        </div>
      )}

      <AgentDialog
        open={editing !== null}
        mode="edit"
        name={editName}
        instructions={editInstructions}
        saving={savingEdit}
        onNameChange={setEditName}
        onInstructionsChange={setEditInstructions}
        onClose={() => setEditing(null)}
        onSave={() => void onSaveEdit()}
      />

      <AgentDialog
        open={creating}
        mode="create"
        name={createName}
        instructions={createInstructions}
        saving={savingCreate}
        onNameChange={setCreateName}
        onInstructionsChange={setCreateInstructions}
        onClose={() => setCreating(false)}
        onSave={() => void onSaveCreate()}
      />

    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} }),
  // SEC-3 (PRD 16): configuration pages are OWNER-only (PRD 15.9).
  { requiredRole: "OWNER" }
);
