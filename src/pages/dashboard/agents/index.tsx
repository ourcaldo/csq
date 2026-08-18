import { useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { Robot, Sparkle, Power, Pause, Play } from "@phosphor-icons/react";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Local types — the API route returns the Prisma-serialized Agent shape with
// capabilities included. We mirror the JSON shape here (no `as` assertions,
// no edits to shared types). Prisma serializes DateTime as ISO strings and
// enums as their string values.
// ---------------------------------------------------------------------------

type AgentStatus = "DRAFT" | "ACTIVE" | "PAUSED";

type AgentCapability = {
  id: string;
  tenantId: string;
  agentId: string;
  tool: string;
  allowed: boolean;
  requiresApproval: boolean;
};

type AgentWithCapabilities = {
  id: string;
  tenantId: string;
  name: string;
  status: AgentStatus;
  instructions: string | null;
  openclawCellId: string | null;
  openclawAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities: AgentCapability[];
};

type AgentsList = { items: AgentWithCapabilities[] };

// The full set of registry tool names the owner can toggle per agent. These
// match the tool registry (src/tools/index.ts) and are grouped for display.
const TOOL_GROUPS: { label: string; tools: string[] }[] = [
  { label: "Produk", tools: ["product.read", "product.search", "product.update"] },
  { label: "Inventaris", tools: ["inventory.read", "inventory.update"] },
  { label: "Pesanan", tools: ["order.read", "order.create", "order.cancel"] },
  { label: "Kontak", tools: ["customer.read", "customer.update"] },
  { label: "Pengetahuan", tools: ["knowledge.search"] },
];

const ALL_TOOLS: string[] = TOOL_GROUPS.flatMap((g) => g.tools);

function statusTone(status: AgentStatus): "neutral" | "green" | "amber" {
  if (status === "ACTIVE") return "green";
  if (status === "PAUSED") return "amber";
  return "neutral";
}

function statusLabel(status: AgentStatus): string {
  if (status === "ACTIVE") return "Aktif";
  if (status === "PAUSED") return "Dijeda";
  return "Draf";
}

// Build a lookup of capability overrides for an agent keyed by tool name.
function capabilityMap(agent: AgentWithCapabilities): Record<string, AgentCapability> {
  const map: Record<string, AgentCapability> = {};
  for (const cap of agent.capabilities) {
    map[cap.tool] = cap;
  }
  return map;
}

export default function AgentsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data, loading, error, refresh } = useApi<AgentsList>("/api/dashboard/agents");

  // Track which (agentId, tool) pairs are mid-save so we can disable just
  // those toggles. A Set of `${agentId}:${tool}` strings.
  const [savingCaps, setSavingCaps] = useState<Set<string>>(new Set());
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

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

  return (
    <DashboardShell
      title="Agent"
      description="Kelola agent AI: status deploy dan kapabilitas per alat."
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
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Agent Aktif
              </p>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100 text-green-700">
                <Power size={18} />
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900">{counts.active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Dijeda
              </p>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Pause size={18} />
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900">{counts.paused}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Draf
              </p>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Robot size={18} />
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-slate-900">{counts.draft}</p>
          </div>
        </div>
      )}

      {loading && <LoadingSkeleton rows={3} />}
      {error && <StateNotice variant="error" message={error} />}
      {!loading && !error && agents.length === 0 && (
        <EmptyState
          icon={<Robot size={24} />}
          title="Belum ada agent"
          description="Agent AI akan muncul di sini setelah dibuat oleh sistem."
        />
      )}

      {!loading && !error && agents.length > 0 && (
        <div className="space-y-6">
          {agents.map((agent) => {
            const caps = capabilityMap(agent);
            return (
              <div
                key={agent.id}
                className="rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                {/* Card header */}
                <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-600 text-white">
                      <Robot size={20} weight="fill" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-slate-900">
                          {agent.name}
                        </h2>
                        <BadgeStatus tone={statusTone(agent.status)}>
                          {statusLabel(agent.status)}
                        </BadgeStatus>
                      </div>
                      {agent.instructions ? (
                        <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-slate-500">
                          {agent.instructions}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-slate-400">
                          Belum ada instruksi.
                        </p>
                      )}
                    </div>
                  </div>

                  {isOwner && (
                    <div className="flex shrink-0 items-center gap-2">
                      {agent.status === "ACTIVE" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actioningId === agent.id}
                          onClick={() => onPause(agent)}
                        >
                          <Pause size={16} />
                          Jeda
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={actioningId === agent.id}
                          onClick={() => onDeploy(agent)}
                        >
                          <Play size={16} />
                          Deploy
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Capability matrix */}
                <div className="p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkle size={16} className="text-green-600" />
                    <h3 className="text-sm font-semibold text-slate-900">
                      Kapabilitas Alat
                    </h3>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Alat</TableHead>
                          <TableHead className="w-40">Diizinkan</TableHead>
                          <TableHead className="w-48">Butuh Approval</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {TOOL_GROUPS.map((group, gi) => {
                          const rows = group.tools.map((tool) => {
                            const cap = caps[tool];
                            const allowed = cap?.allowed ?? false;
                            const requiresApproval = cap?.requiresApproval ?? false;
                            const savingKey = `${agent.id}:${tool}`;
                            const saving = savingCaps.has(savingKey);
                            return (
                              <TableRow key={tool}>
                                <TableCell>
                                  <div className="flex flex-col">
                                    <span className="font-mono text-sm text-slate-800">
                                      {tool}
                                    </span>
                                    {gi === 0 && (
                                      <span className="text-[11px] uppercase tracking-wider text-slate-400">
                                        {group.label}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Switch
                                    checked={allowed}
                                    disabled={!isOwner || saving}
                                    onChange={(v) =>
                                      onCapabilityChange(agent, tool, "allowed", v)
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Switch
                                    checked={requiresApproval}
                                    disabled={!isOwner || saving || !allowed}
                                    onChange={(v) =>
                                      onCapabilityChange(
                                        agent,
                                        tool,
                                        "requiresApproval",
                                        v
                                      )
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          });
                          // Insert a subtle group separator row before each
                          // new group (except the first).
                          const sep =
                            gi > 0 ? (
                              <TableRow key={`sep-${group.label}`}>
                                <TableCell colSpan={3} className="bg-slate-50/60 py-1">
                                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                    {group.label}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ) : null;
                          return sep ? [sep, ...rows] : rows;
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {!isOwner && (
                    <p className="mt-3 text-xs text-slate-400">
                      Kapabilitas hanya dapat diubah oleh owner.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
