import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, DragEvent, MouseEvent as ReactMouseEvent } from "react";
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
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import type { Node, Edge, Connection, NodeChange, EdgeChange } from "@xyflow/react";
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
import { edgeTypes } from "@/components/dashboard/scenario/edge";

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
  { type: "ai", label: "Pesan AI" },
  { type: "wait", label: "Tunggu" },
  { type: "condition", label: "Kondisi (IF)" },
  { type: "tag", label: "Tag" },
  { type: "setStage", label: "Tahap Deal" },
  { type: "assign", label: "Tugaskan" },
  { type: "email", label: "Email" },
  { type: "end", label: "Selesai" },
];

// Node types insertable into the middle of an existing edge (splice). Excludes
// condition (needs true/false handles, not a single in/out) and end (no output).
const INSERTABLE: { type: string; label: string }[] = [
  { type: "send", label: "Kirim Pesan" },
  { type: "ai", label: "Pesan AI" },
  { type: "wait", label: "Tunggu" },
  { type: "tag", label: "Tag" },
  { type: "setStage", label: "Tahap Deal" },
  { type: "assign", label: "Tugaskan" },
  { type: "email", label: "Email" },
];

// Team member option for the assign node's dropdown (from
// /api/dashboard/scenarios/team — id/name/role only, no secrets).
type TeamMember = { id: string; name: string; role: string };

// Right-click context menu state. `flowX/flowY` are canvas coords for placing a
// new node; `clientX/clientY` are viewport coords for positioning the menu.
type MenuState =
  | { kind: "pane"; clientX: number; clientY: number; flowX: number; flowY: number }
  | { kind: "node"; clientX: number; clientY: number; nodeId: string }
  | { kind: "edge"; clientX: number; clientY: number; edgeId: string }
  | null;

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
  // Assign-node dropdown options. Failure (e.g. network) leaves the list empty
  // and the assign editor degrades to a manual ID input.
  const { data: teamData } = useApi<ListResult<TeamMember>>(
    "/api/dashboard/scenarios/team"
  );
  const team: TeamMember[] = teamData?.items ?? [];

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formInfo, setFormInfo] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const [menu, setMenu] = useState<MenuState>(null);
  const [fullscreen, setFullscreen] = useState(false);

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

  // ── Undo / redo ──
  // Snapshots of {nodes, edges} taken BEFORE a change is applied. past holds
  // prior states (Ctrl+Z restores the last), future holds redos (Ctrl+Y).
  // stateRef always holds the latest committed state so takeSnapshot (called
  // inside change handlers, before applying) captures the pre-change state.
  type Snap = { nodes: Node[]; edges: Edge[] };
  const [past, setPast] = useState<Snap[]>([]);
  const [future, setFuture] = useState<Snap[]>([]);
  const stateRef = useRef<Snap>({ nodes: [], edges: [] });
  const lastSnapRef = useRef(0);
  useEffect(() => {
    stateRef.current = { nodes, edges };
  }, [nodes, edges]);

  const takeSnapshot = useCallback(() => {
    setPast((p) => [...p.slice(-49), stateRef.current]);
    setFuture([]);
    lastSnapRef.current = Date.now();
  }, []);

  // Throttled snapshot for high-frequency edits (property text inputs) so one
  // burst of typing collapses into a single undo entry.
  const takeSnapshotThrottled = useCallback(() => {
    if (Date.now() - lastSnapRef.current < 500) return;
    takeSnapshot();
  }, [takeSnapshot]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [stateRef.current, ...f]);
      setNodes(prev.nodes);
      setEdges(prev.edges);
      stateRef.current = prev;
      setSelectedId(null);
      return p.slice(0, -1);
    });
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p, stateRef.current]);
      setNodes(next.nodes);
      setEdges(next.edges);
      stateRef.current = next;
      setSelectedId(null);
      return f.slice(1);
    });
  }, [setNodes, setEdges]);

  // Wrap the change handlers: snapshot only on 'remove' (deletions), not on
  // every position/select tick (those would flood the history). Drags and
  // connects snapshot at their start events instead.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.some((c) => c.type === "remove")) takeSnapshot();
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes, takeSnapshot]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.some((c) => c.type === "remove")) takeSnapshot();
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges, takeSnapshot]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      takeSnapshot();
      const id = `e-${params.source}-${params.sourceHandle ?? "x"}-${params.target}`;
      setEdges((eds) => addEdge({ ...params, id }, eds));
    },
    [setEdges, takeSnapshot]
  );

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) for undo/redo. Ignored while focus is in
  // a text field so native text undo keeps working.
  useEffect(() => {
    if (!canEdit) return;
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")
      ) {
        return;
      }
      const z = e.key.toLowerCase() === "z";
      const y = e.key.toLowerCase() === "y";
      if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && ((z && e.shiftKey) || y)) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, undo, redo]);

  function defaultDataFor(type: string): Record<string, unknown> {
    if (type === "send") return { body: "" };
    if (type === "ai") return { prompt: "" };
    if (type === "wait") return { durationMs: 60 * 60 * 1000 };
    if (type === "condition") return { field: "", operator: "equals", value: "" };
    if (type === "tag") return { tagName: "" };
    if (type === "setStage") return { stageName: "" };
    if (type === "assign") return { userId: "", userName: "" };
    if (type === "email") return { subject: "", body: "" };
    return {};
  }

  function addNode(type: string, position: { x: number; y: number }): void {
    takeSnapshot();
    const idNew = newId(type);
    setNodes((nds) => [
      ...nds,
      { id: idNew, type, position, data: defaultDataFor(type) },
    ]);
    setSelectedId(idNew);
  }

  // Delete a node and any edges touching it. The trigger is protected (the
  // graph must keep exactly one); other nodes are removable — validation at
  // activate time catches any resulting dangling/terminal-less graph.
  function deleteNode(nodeId: string): void {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type === "trigger") return;
    takeSnapshot();
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (selectedId === nodeId) setSelectedId(null);
  }

  function duplicateNode(nodeId: string): void {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    takeSnapshot();
    const idNew = newId(node.type ?? "node");
    setNodes((nds) => [
      ...nds,
      {
        id: idNew,
        type: node.type,
        position: { x: node.position.x + 48, y: node.position.y + 48 },
        data: { ...node.data },
      },
    ]);
    setSelectedId(idNew);
  }

  function deleteEdge(edgeId: string): void {
    takeSnapshot();
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
  }

  // Splice a new node into an existing edge: remove the edge, place the new
  // node at the midpoint, and wire source→new→target. This is the n8n-style
  // "insert module in the middle of the flow" action.
  function spliceEdge(edgeId: string, type: string): void {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    takeSnapshot();
    const src = nodes.find((n) => n.id === edge.source);
    const tgt = nodes.find((n) => n.id === edge.target);
    if (!src || !tgt) return;
    const idNew = newId(type);
    const mid = {
      x: (src.position.x + tgt.position.x) / 2,
      y: (src.position.y + tgt.position.y) / 2,
    };
    setNodes((nds) => [...nds, { id: idNew, type, position: mid, data: defaultDataFor(type) }]);
    setEdges((eds) => [
      ...eds.filter((e) => e.id !== edgeId),
      { id: `e-${edge.source}-${idNew}`, source: edge.source, target: idNew },
      { id: `e-${idNew}-${edge.target}`, source: idNew, target: edge.target },
    ]);
    setSelectedId(idNew);
  }

  // ── Context menu openers (right-click). Custom menu only when editing;
  // otherwise let the browser show its default menu. ──
  function onPaneContextMenu(e: MouseEvent | ReactMouseEvent): void {
    if (!canEdit) return;
    e.preventDefault();
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setMenu({ kind: "pane", clientX: e.clientX, clientY: e.clientY, flowX: p.x, flowY: p.y });
  }
  function onNodeContextMenu(e: MouseEvent | ReactMouseEvent, node: Node): void {
    if (!canEdit) return;
    e.preventDefault();
    setMenu({ kind: "node", clientX: e.clientX, clientY: e.clientY, nodeId: node.id });
  }
  function onEdgeContextMenu(e: MouseEvent | ReactMouseEvent, edge: Edge): void {
    if (!canEdit) return;
    e.preventDefault();
    setMenu({ kind: "edge", clientX: e.clientX, clientY: e.clientY, edgeId: edge.id });
  }

  // Auto-connect on drag: when a node is dropped with one of its handles very
  // close to another node's opposite handle, create the edge automatically
  // (n8n-style). Picks the closest valid pair within AUTO_CONNECT_PX. For a
  // condition source, uses the first free branch (true then false). Skips
  // duplicates and incompatible endpoints (trigger has no input, end no output).
  const AUTO_CONNECT_PX = 80;
  function canSource(t: string | undefined): boolean {
    return t !== "end";
  }
  function canTarget(t: string | undefined): boolean {
    return t !== "trigger";
  }
  function pickConditionHandle(sourceId: string): "true" | "false" | null {
    const hasTrue = edges.some((e) => e.source === sourceId && e.sourceHandle === "true");
    const hasFalse = edges.some((e) => e.source === sourceId && e.sourceHandle === "false");
    if (!hasTrue) return "true";
    if (!hasFalse) return "false";
    return null;
  }

  function onNodeDragStop(_event: MouseEvent | TouchEvent, dragged: Node): void {
    if (!canEdit) return;
    const dW = dragged.measured?.width ?? 224;
    const dH = dragged.measured?.height ?? 56;
    const dIn = { x: dragged.position.x, y: dragged.position.y + dH / 2 };
    const dOut = { x: dragged.position.x + dW, y: dragged.position.y + dH / 2 };

    let best:
      | { source: string; target: string; sourceHandle: string | undefined; dist: number }
      | null = null;

    for (const other of nodes) {
      if (other.id === dragged.id) continue;
      const oW = other.measured?.width ?? 224;
      const oH = other.measured?.height ?? 56;
      const oOut = { x: other.position.x + oW, y: other.position.y + oH / 2 };
      const oIn = { x: other.position.x, y: other.position.y + oH / 2 };

      // other.output → dragged.input (dragged dropped to the right of other)
      if (canSource(other.type) && canTarget(dragged.type)) {
        const dist = Math.hypot(dIn.x - oOut.x, dIn.y - oOut.y);
        if (dist < AUTO_CONNECT_PX && (!best || dist < best.dist)) {
          const handle =
            other.type === "condition" ? pickConditionHandle(other.id) : undefined;
          if (handle !== null) best = { source: other.id, target: dragged.id, sourceHandle: handle ?? undefined, dist };
        }
      }
      // dragged.output → other.input (dragged dropped to the left of other)
      if (canSource(dragged.type) && canTarget(other.type)) {
        const dist = Math.hypot(dOut.x - oIn.x, dOut.y - oIn.y);
        if (dist < AUTO_CONNECT_PX && (!best || dist < best.dist)) {
          const handle =
            dragged.type === "condition" ? pickConditionHandle(dragged.id) : undefined;
          if (handle !== null) best = { source: dragged.id, target: other.id, sourceHandle: handle ?? undefined, dist };
        }
      }
    }

    if (!best) return;
    const b = best;
    setEdges((eds) => {
      const exists = eds.some(
        (e) =>
          e.source === b.source &&
          e.target === b.target &&
          (e.sourceHandle ?? undefined) === (b.sourceHandle ?? undefined)
      );
      if (exists) return eds;
      return addEdge(
        {
          source: b.source,
          target: b.target,
          sourceHandle: b.sourceHandle,
          id: `e-${b.source}-${b.sourceHandle ?? "x"}-${b.target}`,
        },
        eds
      );
    });
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
    takeSnapshotThrottled();
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

  // Shared pieces rendered in either the normal grid or the fullscreen overlay.
  const paletteInner = (
    <>
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
        Seret modul ke kanvas. Dekatkan ke node lain untuk auto-connect.
      </p>
    </>
  );

  const canvasInner = (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onConnectStart={() => takeSnapshot()}
      onNodeDragStart={() => takeSnapshot()}
      onNodeClick={(_, n) => {
        setSelectedId(n.id);
        setMenu(null);
      }}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={() => setMenu(null)}
      onPaneContextMenu={onPaneContextMenu}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      onMove={() => setMenu(null)}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ type: "default" }}
      deleteKeyCode={canEdit ? ["Backspace", "Delete"] : []}
      fitView
      nodesDraggable={canEdit}
      nodesConnectable={canEdit}
      elementsSelectable={canEdit}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );

  const propertiesInner = (
    <PropertiesPanel node={selectedNode} canEdit={canEdit} onPatch={patchSelected} team={team} />
  );

  return (
    <DashboardShell
      title={scenario.name || "Skenario"}
      description="Susun alur dengan drag-and-drop, lalu simpan atau aktifkan."
      actions={
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={undo}
                disabled={past.length === 0}
                title="Undo (Ctrl+Z)"
              >
                Undo
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={redo}
                disabled={future.length === 0}
                title="Redo (Ctrl+Y)"
              >
                Redo
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setFullscreen(true)}>
            Layar Penuh
          </Button>
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
      {/* Mobile notice — the builder canvas is desktop-only. */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 md:hidden">
        <div className="max-w-sm rounded-lg bg-white p-6 text-center shadow-xl">
          <p className="text-base font-semibold text-slate-900">
            Tidak dapat diakses dari perangkat mobile
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Builder skenario dirancang untuk layar besar dengan drag-and-drop.
            Silakan akses dari perangkat desktop.
          </p>
          <Link href="/dashboard/scenarios" className="mt-4 inline-block">
            <Button variant="outline">Kembali ke daftar skenario</Button>
          </Link>
        </div>
      </div>

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

      {fullscreen ? (
        <div className="fixed inset-0 z-50 bg-white">
          <div className="relative h-full w-full">
            {/* Canvas fills the overlay */}
            <div
              ref={wrapperRef}
              className="absolute inset-0"
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              {canvasInner}
            </div>

            {/* Floating toolbar */}
            <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              {canEdit && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={undo}
                    disabled={past.length === 0}
                    title="Undo (Ctrl+Z)"
                  >
                    Undo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={redo}
                    disabled={future.length === 0}
                    title="Redo (Ctrl+Y)"
                  >
                    Redo
                  </Button>
                </>
              )}
              <Input
                className="h-8 w-44"
                value={name}
                disabled={!canEdit}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama skenario"
              />
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
              <Button size="sm" variant="outline" onClick={() => setFullscreen(false)}>
                Keluar Layar Penuh
              </Button>
            </div>

            {/* Floating palette (left, inside the canvas) */}
            <div className="absolute left-3 top-20 z-10 w-44 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              {paletteInner}
            </div>

            {/* Floating properties (right) */}
            <div className="absolute right-3 top-3 z-10 max-h-[85vh] w-72 overflow-auto rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              {propertiesInner}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[180px_1fr_280px]">
          {/* Palette */}
          <div className="rounded-lg border bg-white p-3">{paletteInner}</div>

          {/* Canvas */}
          <div
            ref={wrapperRef}
            className="h-[520px] rounded-lg border bg-white"
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {canvasInner}
          </div>

          {/* Properties */}
          {propertiesInner}
        </div>
      )}

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

      {menu && (
        <ScenarioContextMenu
          menu={menu}
          isTrigger={
            menu.kind === "node"
              ? nodes.find((n) => n.id === menu.nodeId)?.type === "trigger"
              : false
          }
          onAdd={(type) => {
            if (menu.kind === "pane") addNode(type, { x: menu.flowX, y: menu.flowY });
            setMenu(null);
          }}
          onDuplicate={() => {
            if (menu.kind === "node") duplicateNode(menu.nodeId);
            setMenu(null);
          }}
          onDeleteNode={() => {
            if (menu.kind === "node") deleteNode(menu.nodeId);
            setMenu(null);
          }}
          onSplice={(type) => {
            if (menu.kind === "edge") spliceEdge(menu.edgeId, type);
            setMenu(null);
          }}
          onDeleteEdge={() => {
            if (menu.kind === "edge") deleteEdge(menu.edgeId);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </DashboardShell>
  );
}

function ScenarioContextMenu({
  menu,
  isTrigger,
  onAdd,
  onDuplicate,
  onDeleteNode,
  onSplice,
  onDeleteEdge,
  onClose,
}: {
  menu: NonNullable<MenuState>;
  isTrigger: boolean;
  onAdd: (type: string) => void;
  onDuplicate: () => void;
  onDeleteNode: () => void;
  onSplice: (type: string) => void;
  onDeleteEdge: () => void;
  onClose: () => void;
}) {
  // Fixed-positioned at the cursor (viewport coords from the contextmenu event).
  const style = { left: menu.clientX, top: menu.clientY };
  return (
    <>
      {/* Click-away backdrop so any click outside the menu closes it. */}
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 w-48 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        style={style}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {menu.kind === "pane" && (
          <>
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Tambah modul
            </p>
            {PALETTE.map((p) => (
              <button
                key={p.type}
                className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50"
                onClick={() => onAdd(p.type)}
              >
                {p.label}
              </button>
            ))}
          </>
        )}

        {menu.kind === "node" && (
          <>
            <button
              className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50"
              onClick={onDuplicate}
            >
              Duplikat
            </button>
            <button
              className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={onDeleteNode}
              disabled={isTrigger}
              title={isTrigger ? "Node pemicu tidak dapat dihapus" : undefined}
            >
              Hapus{isTrigger ? " (terkunci)" : ""}
            </button>
          </>
        )}

        {menu.kind === "edge" && (
          <>
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Sisipkan modul
            </p>
            {INSERTABLE.map((p) => (
              <button
                key={p.type}
                className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50"
                onClick={() => onSplice(p.type)}
              >
                {p.label}
              </button>
            ))}
            <div className="my-1 border-t border-slate-100" />
            <button
              className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
              onClick={onDeleteEdge}
            >
              Hapus koneksi
            </button>
          </>
        )}
      </div>
    </>
  );
}

function PropertiesPanel({
  node,
  canEdit,
  onPatch,
  team,
}: {
  node: Node | null;
  canEdit: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  team: TeamMember[];
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

        {type === "ai" && (
          <div>
            <Label className="text-xs">Prompt AI</Label>
            <Textarea
              disabled={!canEdit}
              rows={5}
              value={str(node.data?.prompt)}
              placeholder="Tulis ucapan terima kasih ramah untuk {{customer_name}} atas pesanan {{order_items}}, tanyakan apakah pesanan sudah diterima dengan baik."
              onChange={(e) => onPatch({ prompt: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              AI menulis isi pesannya, lalu dikirim via WhatsApp (tetap mengikuti
              jendela 24 jam). Variabel: {`{{customer_name}}`}, {`{{order_id}}`},{" "}
              {`{{order_total}}`}, {`{{order_items}}`}.
            </p>
          </div>
        )}

        {type === "setStage" && (
          <div>
            <Label className="text-xs">Nama Tahap</Label>
            <Input
              disabled={!canEdit}
              value={str(node.data?.stageName)}
              placeholder="Pesanan"
              onChange={(e) => onPatch({ stageName: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Tahap pipeline percakapan ini (mis. Baru, Tertarik, Penawaran,
              Pesanan, Menang). Deal berpindah ke tahap tersebut.
            </p>
          </div>
        )}

        {type === "assign" && (
          <AssignEditor node={node} canEdit={canEdit} onPatch={onPatch} team={team} />
        )}

        {type === "email" && (
          <>
            <div>
              <Label className="text-xs">Subjek</Label>
              <Input
                disabled={!canEdit}
                value={str(node.data?.subject)}
                placeholder="Terima kasih atas pesanan {{order_id}}"
                onChange={(e) => onPatch({ subject: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Isi Email</Label>
              <Textarea
                disabled={!canEdit}
                rows={6}
                value={str(node.data?.body)}
                placeholder="Halo {{customer_name}}, terima kasih sudah memesan {{order_items}}…"
                onChange={(e) => onPatch({ body: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Dikirim ke email kontak pelanggan lewat integrasi email usaha
                (Pengaturan → Email: SMTP atau Resend). Dilewati (dan dicatat
                di audit) jika kontak tidak punya email atau integrasi belum
                diatur. Variabel sama seperti Kirim Pesan.
              </p>
            </div>
          </>
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

// Assign-node editor: a dropdown of the tenant's members when the team list
// loaded, degrading to a manual user-ID input otherwise (or when the stored
// userId isn't in the list — e.g. the member was removed). Selecting a member
// stores both userId (engine truth) and userName (card display label).
function AssignEditor({
  node,
  canEdit,
  onPatch,
  team,
}: {
  node: Node;
  canEdit: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  team: TeamMember[];
}) {
  const userId = str(node.data?.userId);
  const inList = team.some((m) => m.id === userId);
  return (
    <>
      {team.length > 0 ? (
        <div>
          <Label className="text-xs">Anggota Tim</Label>
          <Select
            disabled={!canEdit}
            value={inList ? userId : ""}
            onChange={(e) => {
              const m = team.find((t) => t.id === e.target.value);
              onPatch({
                userId: m ? m.id : "",
                userName: m ? m.name : "",
              });
            }}
          >
            <option value="">— pilih anggota —</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.role === "OWNER" ? "Owner" : "Staf"})
              </option>
            ))}
          </Select>
          {!inList && userId && (
            <p className="mt-1 text-[11px] text-amber-700">
              Anggota tersimpan tidak ada di daftar tim — pilih ulang.
            </p>
          )}
        </div>
      ) : (
        <div>
          <Label className="text-xs">ID Anggota Tim</Label>
          <Input
            disabled={!canEdit}
            value={userId}
            placeholder="user id (uuid)"
            onChange={(e) => onPatch({ userId: e.target.value, userName: "" })}
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Daftar tim belum termuat — masukkan ID anggota manual.
          </p>
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Percakapan ditugaskan ke anggota ini; AI berhenti membalas otomatis
        sampai dikembalikan.
      </p>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<{ id: string }> = withAuth<
  { id: string }
>(async (ctx: GetServerSidePropsContext) => {
  const id = typeof ctx.params?.["id"] === "string" ? ctx.params["id"] : "";
  return { props: { id } };
});
