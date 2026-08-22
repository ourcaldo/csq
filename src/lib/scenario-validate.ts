import type { ScenarioGraph, ScenarioNode } from "@/types/scenario";
import { CLOUD_API_WINDOW_MS } from "@/lib/inbox";

// Graph validation at activate/save time. A malformed graph must never reach the
// runtime — the engine assumes a valid DAG. Returns errors (block activation)
// and warnings (shown but non-blocking). `cloudApi` controls the 24h send-window
// warning: only relevant for Cloud API tenants (Baileys has no window).
export type ValidationResult = {
  errors: string[];
  warnings: string[];
};

export function validateScenarioGraph(
  graph: ScenarioGraph,
  opts: { cloudApi: boolean }
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodes = graph.nodes;
  const edges = graph.edges;

  if (nodes.length === 0) {
    return { errors: ["Graph kosong — tambahkan minimal satu node."], warnings };
  }

  const byId = new Map<string, ScenarioNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) errors.push(`Node id duplikat: ${n.id}.`);
    byId.set(n.id, n);
  }

  // Edges reference existing nodes.
  for (const e of edges) {
    if (!byId.has(e.source)) errors.push(`Edge ${e.id} menunjuk node sumber tidak ada: ${e.source}.`);
    if (!byId.has(e.target)) errors.push(`Edge ${e.id} menunjuk node tujuan tidak ada: ${e.target}.`);
  }

  // Exactly one trigger.
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) errors.push("Tidak ada node trigger.");
  if (triggers.length > 1) errors.push("Hanya boleh ada satu node trigger.");
  const trigger = triggers[0];

  // Trigger cross-field: ON_TAG_ADDED requires tagName.
  if (trigger && trigger.data.triggerType === "ON_TAG_ADDED" && !trigger.data.tagName) {
    errors.push("Trigger ON_TAG_ADDED memerlukan nama tag.");
  }

  // At least one end node.
  const hasEnd = nodes.some((n) => n.type === "end");
  if (!hasEnd) errors.push("Tidak ada node End — setiap cabang harus berakhir di End.");

  // Outgoing edges per node.
  const outEdges = (id: string) => edges.filter((e) => e.source === id);
  for (const n of nodes) {
    const outs = outEdges(n.id);
    if (n.type === "end") {
      if (outs.length > 0) errors.push(`Node End (${n.id}) tidak boleh memiliki edge keluar.`);
      continue;
    }
    if (outs.length === 0) {
      errors.push(`Node ${n.type} (${n.id}) tidak terhubung ke node lain.`);
    }
    // Condition must branch on both handles.
    if (n.type === "condition") {
      const hasTrue = outs.some((e) => e.sourceHandle === "true");
      const hasFalse = outs.some((e) => e.sourceHandle === "false");
      if (!hasTrue) errors.push(`Node condition (${n.id}) tidak memiliki cabang "true".`);
      if (!hasFalse) errors.push(`Node condition (${n.id}) tidak memiliki cabang "false".`);
    }
    // Non-condition nodes must have a single plain outgoing edge (no sourceHandle).
    if (n.type !== "condition" && outs.length > 1) {
      errors.push(`Node ${n.type} (${n.id}) hanya boleh memiliki satu edge keluar.`);
    }
  }

  // Cycle detection (DAG) + reachability from trigger, via DFS coloring.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  let cycleFound = false;
  function dfs(id: string): void {
    const c = color.get(id);
    if (c === GRAY) {
      cycleFound = true;
      return;
    }
    if (c === BLACK) return;
    color.set(id, GRAY);
    for (const e of outEdges(id)) {
      if (byId.has(e.target)) dfs(e.target);
      if (cycleFound) return;
    }
    color.set(id, BLACK);
  }
  if (trigger) dfs(trigger.id);
  if (cycleFound) {
    errors.push("Graph memiliki siklus — scenario harus berupa DAG (tanpa loop).");
  }

  // Reachability: every node must be reachable from the trigger (no dangling).
  if (trigger) {
    const reachable = new Set<string>();
    function reach(id: string): void {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const e of outEdges(id)) {
        if (byId.has(e.target)) reach(e.target);
      }
    }
    reach(trigger.id);
    for (const n of nodes) {
      if (!reachable.has(n.id)) {
        errors.push(`Node ${n.type} (${n.id}) tidak terjangkau dari trigger.`);
      }
    }

    // Every reachable non-end node must eventually reach an end node.
    const reachesEnd = new Map<string, boolean>();
    function canReachEnd(id: string): boolean {
      const memo = reachesEnd.get(id);
      if (memo !== undefined) return memo;
      const node = byId.get(id);
      if (node?.type === "end") {
        reachesEnd.set(id, true);
        return true;
      }
      // Tentative false to break cycles (already errored above if cyclic).
      reachesEnd.set(id, false);
      let ok = false;
      for (const e of outEdges(id)) {
        if (byId.has(e.target) && canReachEnd(e.target)) ok = true;
      }
      reachesEnd.set(id, ok);
      return ok;
    }
    for (const id of reachable) {
      const node = byId.get(id);
      if (node && node.type !== "end" && !canReachEnd(id)) {
        errors.push(`Node ${node.type} (${id}) tidak mencapai node End.`);
      }
    }
  }

  // 24h window warning (Cloud API only): if a Send sits behind Waits summing
  // to >= 24h along any path, the runtime will skip it (window closed). Warn
  // at build time so the owner knows. This is heuristic — the real check is
  // at send time against the customer's last inbound timestamp.
  if (opts.cloudApi && trigger) {
    const sendWarned = new Set<string>();
    function walk(id: string, accWaitMs: number): void {
      const node = byId.get(id);
      if (!node) return;
      let wait = accWaitMs;
      if (node.type === "wait") wait += node.data.durationMs;
      if (node.type === "send" && wait >= CLOUD_API_WINDOW_MS && !sendWarned.has(id)) {
        sendWarned.add(id);
        warnings.push(
          `Node Send (${id}) mungkin melewati jendela 24 jam Cloud API dan akan dilewati saat runtime.`
        );
      }
      for (const e of outEdges(id)) {
        if (byId.has(e.target)) walk(e.target, wait);
      }
    }
    walk(trigger.id, 0);
  }

  return { errors, warnings };
}
