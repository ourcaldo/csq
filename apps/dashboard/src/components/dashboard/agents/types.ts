export type AgentStatus = "DRAFT" | "ACTIVE" | "PAUSED";

export type AgentCapability = {
  id: string;
  tenantId: string;
  agentId: string;
  tool: string;
  allowed: boolean;
  requiresApproval: boolean;
};

export type AgentWithCapabilities = {
  id: string;
  tenantId: string;
  name: string;
  status: AgentStatus;
  instructions: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities: AgentCapability[];
};

export type AgentsList = { items: AgentWithCapabilities[]; tools: ToolDefault[] };

// COR-3 (PRD 16): the registry default for one tool, mirrored from
// listToolSummaries so the UI can show the EFFECTIVE permission.
export type ToolDefault = {
  name: string;
  description: string;
  category: string;
  defaultPermission: { allowed: boolean; requiresApproval: boolean };
};

// The full set of registry tool names the owner can toggle per agent. These
// match the tool registry (src/tools/index.ts) and are grouped for display.
export const TOOL_GROUPS: { label: string; tools: string[] }[] = [
  { label: "Produk", tools: ["product.read", "product.search", "product.update"] },
  { label: "Inventaris", tools: ["inventory.read", "inventory.update"] },
  { label: "Pesanan", tools: ["order.read", "order.create", "order.cancel"] },
  { label: "Kontak", tools: ["customer.read", "customer.update"] },
  { label: "Pengetahuan", tools: ["knowledge.search"] },
  { label: "Percakapan", tools: ["conversation.handoff"] },
  { label: "Ingatan", tools: ["memory.search", "memory.create"] },
  { label: "Sumber Data", tools: ["source.search"] },
  { label: "Pipeline", tools: ["deal.setStage"] },
];

export function statusTone(status: AgentStatus): "neutral" | "green" | "amber" {
  if (status === "ACTIVE") return "green";
  if (status === "PAUSED") return "amber";
  return "neutral";
}

export function statusLabel(status: AgentStatus): string {
  if (status === "ACTIVE") return "Aktif";
  if (status === "PAUSED") return "Dijeda";
  return "Draf";
}

// Build a lookup of capability overrides for an agent keyed by tool name.
export function capabilityMap(
  agent: AgentWithCapabilities
): Record<string, AgentCapability> {
  const map: Record<string, AgentCapability> = {};
  for (const cap of agent.capabilities) {
    map[cap.tool] = cap;
  }
  return map;
}
