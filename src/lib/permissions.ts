import prisma from "@/lib/db";
import { getTool } from "@/tools";
import type { PermissionResult } from "@/types/tools";

// Capability resolution (SDD §4.4 / §6.2 step 3). An AgentCapability override
// for (agentId, tool) wins; otherwise the tool's defaultPermission applies.
// Read tools default to allowed/no-approval; write tools to denied/approval
// [FR-CP-001..008]. Capability is never inferred from conversation content —
// only from the verified (agentId, toolName) record (prompt-injection defense).
export async function checkPermission(
  _tenantId: string,
  agentId: string,
  toolName: string
): Promise<PermissionResult> {
  const cap = await prisma.agentCapability.findUnique({
    where: { agentId_tool: { agentId, tool: toolName } },
  });
  if (cap) {
    return { allowed: cap.allowed, requiresApproval: cap.requiresApproval };
  }
  const tool = getTool(toolName);
  if (!tool) {
    return { allowed: false, requiresApproval: false };
  }
  return tool.defaultPermission;
}

// Dashboard-facing capability config: set an explicit override. The owner
// enables a write tool per agent (and may keep requiresApproval true).
export async function grantCapability(
  tenantId: string,
  agentId: string,
  tool: string,
  allowed: boolean,
  requiresApproval: boolean
): Promise<void> {
  await prisma.agentCapability.upsert({
    where: { agentId_tool: { agentId, tool } },
    update: { allowed, requiresApproval },
    create: { tenantId, agentId, tool, allowed, requiresApproval },
  });
}

// Remove the override so the tool reverts to its defaultPermission.
export async function revokeCapability(
  agentId: string,
  tool: string
): Promise<void> {
  await prisma.agentCapability.deleteMany({ where: { agentId, tool } });
}
