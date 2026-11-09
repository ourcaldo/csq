import { Pause, Pencil, Play, Robot, Sparkle, Trash } from "@phosphor-icons/react";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Button } from "@csq/ui/components/ui/button";
import { Separator } from "@csq/ui/components/ui/separator";
import { Switch } from "@csq/ui/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@csq/ui/components/ui/table";
import {
  capabilityMap,
  statusLabel,
  statusTone,
  TOOL_GROUPS,
  type AgentWithCapabilities,
  type ToolDefault,
} from "./types";

export function AgentCard(props: {
  agent: AgentWithCapabilities;
  isOwner: boolean;
  actioningId: string | null;
  savingCaps: Set<string>;
  // COR-3 (PRD 16): registry defaults; an agent without an override shows
  // the default, not OFF.
  toolDefaults: ToolDefault[];
  onEdit: (agent: AgentWithCapabilities) => void;
  onPause: (agent: AgentWithCapabilities) => void;
  onDeploy: (agent: AgentWithCapabilities) => void;
  // FEA-4 (PRD 16): delete is OWNER-only; the page owns the confirm dialog.
  onDelete: (agent: AgentWithCapabilities) => void;
  onCapabilityChange: (
    agent: AgentWithCapabilities,
    tool: string,
    field: "allowed" | "requiresApproval",
    value: boolean
  ) => void;
}) {
  const agent = props.agent;
  const caps = capabilityMap(agent);
  const defaults = new Map(props.toolDefaults.map((t) => [t.name, t]));

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
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
              <p className="mt-1 text-sm text-slate-400">Belum ada instruksi.</p>
            )}
          </div>
        </div>

        {props.isOwner && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => props.onEdit(agent)}>
              <Pencil size={16} />
              Edit
            </Button>
            {agent.status === "ACTIVE" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={props.actioningId === agent.id}
                onClick={() => props.onPause(agent)}
              >
                <Pause size={16} />
                Jeda
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={props.actioningId === agent.id}
                onClick={() => props.onDeploy(agent)}
              >
                <Play size={16} />
                Deploy
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={props.actioningId === agent.id}
              onClick={() => props.onDelete(agent)}
            >
              <Trash size={16} />
              Hapus
            </Button>
          </div>
        )}
      </div>

      <Separator />

      <div className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkle size={16} className="text-green-600" />
          <h3 className="text-sm font-semibold text-slate-900">Kapabilitas Alat</h3>
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
                  const def = defaults.get(tool);
                  const allowed = cap?.allowed ?? def?.defaultPermission.allowed ?? false;
                  const requiresApproval =
                    cap?.requiresApproval ?? def?.defaultPermission.requiresApproval ?? false;
                  const savingKey = `${agent.id}:${tool}`;
                  const saving = props.savingCaps.has(savingKey);
                  return (
                    <TableRow key={tool}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-mono text-sm text-slate-800">{tool}</span>
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
                          disabled={!props.isOwner || saving}
                          onChange={(v) =>
                            props.onCapabilityChange(agent, tool, "allowed", v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={requiresApproval}
                          disabled={!props.isOwner || saving || !allowed}
                          onChange={(v) =>
                            props.onCapabilityChange(
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

        {!props.isOwner && (
          <p className="mt-3 text-xs text-slate-400">
            Kapabilitas hanya dapat diubah oleh owner.
          </p>
        )}
      </div>
    </div>
  );
}
