import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, DragEvent } from "react";
import type { GetServerSideProps, GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import type { Node, Edge, Connection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Scenario, ScenarioStatus, ScenarioTriggerType } from "@/types/scenario";
import type { ListResult } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { nodeTypes } from "@/components/dashboard/scenario/nodes";

// Scenario visual builder (React Flow). Drag nodes from the palette onto the
// canvas, connect them, edit each node's config in the right panel, then Save
// (draft) or Activate (OWNER — runs graph validation). Fire-and-forget flows:
// the scenario injects outbound messages at trigger times and never owns the
// conversation.

const TRIGGER_LABEL: Record<ScenarioTriggerType, string> = {
  ON_NEW_CONVERSATION: "Percakapan baru",
  ON_PURCHASE: "Pesanan dibuat",
  ON_TAG_ADDED: "Tag ditambahkan",
};

const STATUS_TONE: Record<ScenarioStatus, "neutral" | "green" | "amber"> = {
  DRAFT: "neutral",
  ACTIVE: "green",
  PAUSED: "amber",
};
const STATUS_LABEL: Record<ScenarioStatus, string> = {
  DRAFT: "Draf",
  ACTIVE: "Aktif",
  PAUSED: "Jeda",
};

const PALETTE: { type: string; label: string }[] = [
  { type: "send", label: "Kirim Pesan" },
  { type: "wait", label: "Tunggu" },
  { type: "condition", label: "Kondisi (IF)" },
  { type: "tag", label: "Tag" },
  { type: "end", label: "Selesai" },
];

function str(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export default function ScenarioBuilderPage({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <Builder id={id} />
    </ReactFlowProvider>
  );
}

type RunItem = {
  id: string;
  status: ScenarioStatus | string;
  dedupKey: string;
  createdAt: string;
};

function Builder({ id }: { id: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";
  const canEdit = isOwner || session?.user?.role === "STAFF";

  const { data: scenario, loading, error, refresh } = useApi<Scenario>(
    `/api/dashboard/scenarios/${id}`
  );
  const { data: runsData } = useApi<ListResult<RunItem>>(
    `/api/dashboard/scenarios/${id}/runs?pageSize=5`
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formInfo, setFormInfo] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Hydrate canvas + form once the scenario loads.
  useEffect(() => {
    if (!scenario) return;
    setNodes(scenario.graph.nodes);
    setEdges(scenario.graph.edges);
    setName(scenario.name);
    setDescription(scenario.description ?? "");
  }, [scenario, setNodes, setEdges]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const id = `e-${params.source}-${params.sourceHandle ?? "x"}-${params.target}`;
      setEdges((eds) => addEdge({ ...params, id }, eds));
    },
    [setEdges]
  );

  function addNode(type: string, position: { x: number; y: number }): void {
    const idNew = newId(type);
    let data: Record<string, unknown> = {};
    if (type === "send") data = { body: "" };
    else if (type === "wait") data = { durationMs: 60 * 60 * 1000 };
    else if (type === "condition") data = { field: "", operator: "equals", value: "" };
    else if (type === "tag") data = { tagName: "" };
    setNodes((nds) => [
      ...nds,
      { id: idNew, type, position, data },
    ]);
    setSelectedId(idNew);
  }

  function onDragStart(e: DragEvent, type: string): void {
    e.dataTransfer.setData("application/scenario", type);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/scenario");
    if (!type) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(type, position);
  }

  // Update one field on the selected node's data.
  function patchSelected(patch: Record<string, unknown>): void {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n
      )
    );
  }

  async function onSave(e?: FormEvent): Promise<void> {
    e?.preventDefault();
    if (!scenario) return;
    setSaving(true);
    setFormError(null);
    setFormInfo(null);
    const trigger = nodes.find((n) => n.type === "trigger");
    const triggerType = str(trigger?.data?.triggerType);
    const tagName = str(trigger?.data?.tagName);
    const graph = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
      })),
    };
    try {
      await apiSend<Scenario>(`/api/dashboard/scenarios/${id}`, "PUT", {
        name,
        description: description || undefined,
        triggerType,
        triggerConfig: tagName ? { tagName } : {},
        graph,
      });
      setFormInfo("Tersimpan.");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function onToggleActive(): Promise<void> {
    if (!scenario) return;
    setBusy(true);
    setFormError(null);
    setFormInfo(null);
    try {
      if (scenario.status === "ACTIVE") {
        await apiSend(`/api/dashboard/scenarios/${id}/pause`, "POST");
        setFormInfo("Skenario dijeda.");
      } else {
        // Activate runs graph validation server-side.
        const res = await apiSend<{ scenario: Scenario; warnings: string[] }>(
          `/api/dashboard/scenarios/${id}/activate`,
          "POST"
        );
        if (res.warnings.length > 0) {
          setFormInfo(`Aktif. Peringatan: ${res.warnings.join(" ")}`);
        } else {
          setFormInfo("Skenario diaktifkan.");
        }
      }
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <DashboardShell title="Skenario" description="Memuat…">
        <StateNotice variant="loading" message="Memuat skenario…" />
      </DashboardShell>
    );
  }
  if (error || !scenario) {
    return (
      <DashboardShell title="Skenario" description="Tidak ditemukan.">
        <StateNotice variant="error" message={error ?? "Skenario tidak ditemukan."} />
        <div className="mt-4">
          <Link href="/dashboard/scenarios">
            <Button variant="outline">Kembali</Button>
          </Link>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title={scenario.name || "Skenario"}
      description="Susun alur dengan drag-and-drop, lalu simpan atau aktifkan."
      actions={
        <div className="flex items-center gap-2">
          <Link href="/dashboard/scenarios">
            <Button variant="outline" size="sm">
              Kembali
            </Button>
          </Link>
          {canEdit && (
            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          )}
          {isOwner && (
            <Button
              size="sm"
              variant={scenario.status === "ACTIVE" ? "outline" : "default"}
              onClick={onToggleActive}
              disabled={busy}
            >
              {busy ? "…" : scenario.status === "ACTIVE" ? "Jeda" : "Aktifkan"}
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <BadgeStatus tone={STATUS_TONE[scenario.status]}>
          {STATUS_LABEL[scenario.status]}
        </BadgeStatus>
        <span className="text-xs text-slate-500">
          Pemicu: {TRIGGER_LABEL[scenario.triggerType]}
        </span>
        {formInfo && <span className="text-xs text-green-700">{formInfo}</span>}
        {formError && <span className="text-xs text-destructive">{formError}</span>}
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-1">
          <Label htmlFor="scn-name">Nama</Label>
          <Input
            id="scn-name"
            value={name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="scn-desc">Deskripsi</Label>
          <Input
            id="scn-desc"
            value={description}
            disabled={!canEdit}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[180px_1fr_280px]">
        {/* Palette */}
        <div className="rounded-lg border bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Modul
          </p>
          <div className="space-y-2">
            {PALETTE.map((p) => (
              <div
                key={p.type}
                draggable={canEdit}
                onDragStart={(e) => onDragStart(e, p.type)}
                className="cursor-grab rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                {p.label}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Seret modul ke kanvas. Hubungkan dengan menarik dari titik node.
          </p>
        </div>

        {/* Canvas */}
        <div
          ref={wrapperRef}
          className="h-[520px] rounded-lg border bg-white"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            elementsSelectable={canEdit}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Properties */}
        <PropertiesPanel
          node={selectedNode}
          canEdit={canEdit}
          onPatch={patchSelected}
        />
      </div>

      {/* Run history */}
      <div className="mt-6">
        <p className="mb-2 text-sm font-semibold text-slate-700">Run Terakhir</p>
        {runsData && runsData.items.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Ref</th>
                  <th className="px-3 py-2">Waktu</th>
                </tr>
              </thead>
              <tbody>
                {runsData.items.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2">{str(r.status)}</td>
                    <td className="px-3 py-2 text-slate-500">{str(r.dedupKey) || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Belum ada run.</p>
        )}
      </div>
    </DashboardShell>
  );
}

function PropertiesPanel({
  node,
  canEdit,
  onPatch,
}: {
  node: Node | null;
  canEdit: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  if (!node) {
    return (
      <div className="rounded-lg border bg-white p-3 text-sm text-slate-500">
        Pilih sebuah node untuk mengubah propertinya.
      </div>
    );
  }
  const type = node.type ?? "";
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Properti: {type}
      </p>
      <div className="space-y-3">
        {type === "trigger" && (
          <>
            <div>
              <Label className="text-xs">Tipe Pemicu</Label>
              <Select
                disabled={!canEdit}
                value={str(node.data?.triggerType)}
                onChange={(e) => onPatch({ triggerType: e.target.value })}
              >
                <option value="ON_NEW_CONVERSATION">Percakapan baru</option>
                <option value="ON_PURCHASE">Pesanan dibuat</option>
                <option value="ON_TAG_ADDED">Tag ditambahkan</option>
              </Select>
            </div>
            {str(node.data?.triggerType) === "ON_TAG_ADDED" && (
              <div>
                <Label className="text-xs">Nama Tag</Label>
                <Input
                  disabled={!canEdit}
                  value={str(node.data?.tagName)}
                  onChange={(e) => onPatch({ tagName: e.target.value })}
                />
              </div>
            )}
          </>
        )}

        {type === "send" && (
          <div>
            <Label className="text-xs">Pesan</Label>
            <Textarea
              disabled={!canEdit}
              rows={5}
              value={str(node.data?.body)}
              placeholder="Halo {{customer_name}}, makasih udah order {{order_id}}. Survei: https://s.id/s?o={{order_id}}"
              onChange={(e) => onPatch({ body: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Gunakan {`{{customer_name}}`}, {`{{order_id}}`}, {`{{order_total}}`}, {`{{order_items}}`}.
            </p>
          </div>
        )}

        {type === "wait" && (
          <WaitEditor node={node} canEdit={canEdit} onPatch={onPatch} />
        )}

        {type === "condition" && (
          <>
            <div>
              <Label className="text-xs">Field</Label>
              <Input
                disabled={!canEdit}
                value={str(node.data?.field)}
                placeholder="order_total"
                onChange={(e) => onPatch({ field: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Operator</Label>
              <Select
                disabled={!canEdit}
                value={str(node.data?.operator)}
                onChange={(e) => onPatch({ operator: e.target.value })}
              >
                <option value="equals">sama dengan</option>
                <option value="not_equals">tidak sama</option>
                <option value="contains">mengandung</option>
                <option value="greater_than">lebih besar</option>
                <option value="less_than">lebih kecil</option>
                <option value="is_set">bernilai</option>
                <option value="is_not_set">kosong</option>
              </Select>
            </div>
            {str(node.data?.operator) !== "is_set" &&
              str(node.data?.operator) !== "is_not_set" && (
                <div>
                  <Label className="text-xs">Nilai</Label>
                  <Input
                    disabled={!canEdit}
                    value={str(node.data?.value)}
                    onChange={(e) => onPatch({ value: e.target.value })}
                  />
                </div>
              )}
          </>
        )}

        {type === "tag" && (
          <div>
            <Label className="text-xs">Nama Tag</Label>
            <Input
              disabled={!canEdit}
              value={str(node.data?.tagName)}
              placeholder="survey-sent"
              onChange={(e) => onPatch({ tagName: e.target.value })}
            />
          </div>
        )}

        {type === "end" && <p className="text-xs text-slate-500">Node akhir — tidak ada properti.</p>}
      </div>
    </div>
  );
}

function WaitEditor({
  node,
  canEdit,
  onPatch,
}: {
  node: Node;
  canEdit: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const ms = num(node.data?.durationMs);
  const isHours = ms >= 60 * 60 * 1000 && ms % (60 * 60 * 1000) === 0;
  const unit = isHours ? "hours" : "minutes";
  const amount = isHours ? Math.round(ms / (60 * 60 * 1000)) : Math.round(ms / (60 * 1000));
  return (
    <>
      <div>
        <Label className="text-xs">Durasi</Label>
        <Input
          type="number"
          min={1}
          disabled={!canEdit}
          value={amount || ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            const base = unit === "hours" ? 60 * 60 * 1000 : 60 * 1000;
            onPatch({ durationMs: Number.isFinite(n) && n > 0 ? n * base : 0 });
          }}
        />
      </div>
      <div>
        <Label className="text-xs">Satuan</Label>
        <Select
          disabled={!canEdit}
          value={unit}
          onChange={(e) => {
            const newUnit = e.target.value;
            const base = newUnit === "hours" ? 60 * 60 * 1000 : 60 * 1000;
            onPatch({ durationMs: (amount || 1) * base });
          }}
        >
          <option value="minutes">menit</option>
          <option value="hours">jam</option>
        </Select>
      </div>
      {ms >= 24 * 60 * 60 * 1000 && (
        <p className="text-[11px] text-amber-700">
          Di Cloud API, pesan setelah tunggu &ge; 24 jam mungkin dilewati (jendela 24 jam).
        </p>
      )}
    </>
  );
}

export const getServerSideProps: GetServerSideProps<{ id: string }> = withAuth<
  { id: string }
>(async (ctx: GetServerSidePropsContext) => {
  const id = typeof ctx.params?.["id"] === "string" ? ctx.params["id"] : "";
  return { props: { id } };
});
