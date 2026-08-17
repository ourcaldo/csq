// Tool registry (SDD §4.4). A Map<string, ToolDefinition> populated at module
// load from the per-domain tool files. Every tool is tenant-scoped,
// agent-scoped, permission-checked, audited, and Zod-validated by execute.ts.
//
// The map value is the erased ToolDefinition: tools have divergent param
// shapes, and a heterogeneous collection needs an existential type. `any` here
// is that bounded existential — it is a type parameter on the collection, not
// a type assertion. No `as` is used anywhere in this module.

import type { ToolDefinition, ToolSummary } from "@/types/tools";
import { productTools } from "./product";
import { inventoryTools } from "./inventory";
import { orderTools } from "./order";
import { customerTools } from "./customer";
import { knowledgeTools } from "./knowledge";

const registry = new Map<string, ToolDefinition<any>>();

export function registerTool<P extends Record<string, unknown>>(
  def: ToolDefinition<P>
): void {
  if (registry.has(def.name)) {
    throw new Error(`Tool already registered: ${def.name}`);
  }
  registry.set(def.name, def);
}

export function getTool(name: string): ToolDefinition<any> | undefined {
  return registry.get(name);
}

export function listTools(): ToolDefinition<any>[] {
  return Array.from(registry.values());
}

export function listToolSummaries(): ToolSummary[] {
  return listTools().map((t) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    defaultPermission: t.defaultPermission,
  }));
}

// Register every tool at module load. No name conflicts — registerTool throws
// on duplicates. Defaults: *.read allowed/no-approval; *.update|*.create|
// *.cancel denied/approval (the owner must explicitly enable writes).
const allTools: ToolDefinition<any>[] = [
  ...productTools,
  ...inventoryTools,
  ...orderTools,
  ...customerTools,
  ...knowledgeTools,
];
for (const t of allTools) {
  registerTool(t);
}
