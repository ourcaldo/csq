import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import prisma from "@/lib/db";
import type { Agent, Tenant } from "@prisma/client";

// Per-tenant OpenClaw cell provisioning (PRD §5/§26: one isolated cell per
// tenant). The platform is the control plane — it creates the cell and the
// agents inside it; OpenClaw never touches CSQ's DB and CSQ never assumes an
// agent exists without provisioning it.
//
// Two backends, selected by OPENCLAW_PROVISIONING:
//   - "fleet"   (production, VPS): `openclaw fleet create <slug> --json`
//                spawns a hardened Gateway container per tenant with its own
//                state dir, credentials, LLM key, sessions, workspace. Agents
//                are created inside the cell with `openclaw agents add`.
//   - "shared"  (dev only): all tenants point at a single shared gateway
//                (OPENCLAW_BASE_URL/OPENCLAW_API_KEY). Agents target the
//                shared `default` agent — NO per-tenant or per-agent
//                isolation. This is a development convenience only; the
//                production path is "fleet".
//
// Server-only. Secrets stay server-side. No `as` casts: the `fleet create
// --json` output is Zod-parsed at the boundary.

const execAsync = promisify(exec);

const PROVISIONING = process.env.OPENCLAW_PROVISIONING ?? "shared";
const SHARED_BASE_URL =
  process.env.OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789";
const SHARED_TOKEN =
  process.env.OPENCLAW_API_KEY ??
  process.env.OPENCLAW_GATEWAY_TOKEN ??
  "";
// Model each OpenClaw agent uses (Fireworks/Qwen). Overridable per env.
const AGENT_MODEL =
  process.env.OPENCLAW_AGENT_MODEL ??
  "fireworks/accounts/fireworks/models/qwen3p7-plus";

// Fleet tenant ids must match ^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$. Slugs
// produced by the register route already satisfy this; clamp defensively.
function fleetSlug(slug: string): string {
  const s = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 40) || "tenant";
}

// Deterministic, slug-safe OpenClaw agent id for a CSQ agent.
function openclawAgentIdFor(agent: Agent): string {
  return `csq-${agent.id.slice(0, 8)}`;
}

// ─────────────────────────── Cell connection ───────────────────────────

export type CellConnection = {
  cellId: string | null;
  baseUrl: string;
  token: string;
};

// Resolve the cell connection for runtime targeting. Falls back to the shared
// gateway env vars when a tenant has no provisioned cell (e.g. the dev
// tenant, or before provisioning completes) so the app never hard-fails on a
// missing cell at request time.
export async function getCellForTenant(
  tenantId: string
): Promise<CellConnection> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (tenant?.openclawBaseUrl && tenant.openclawToken) {
    return {
      cellId: tenant.openclawCellId,
      baseUrl: tenant.openclawBaseUrl,
      token: tenant.openclawToken,
    };
  }
  return { cellId: null, baseUrl: SHARED_BASE_URL, token: SHARED_TOKEN };
}

// ─────────────────────────── fleet --json output ───────────────────────────
// The exact JSON keys of `openclaw fleet create --json` are not fully
// documented; the docs only say the result "includes the tenant ID, container
// name, host port, Gateway token, and local URL." Parse permissively and
// normalize. (Confirm against real output on the VPS during the provisioning
// spike — see plan.)
const fleetCreateSchema = z
  .object({
    tenantId: z.string().optional(),
    tenant: z.string().optional(),
    container: z.string().optional(),
    containerName: z.string().optional(),
    name: z.string().optional(),
    hostPort: z.union([z.number(), z.string()]).optional(),
    port: z.union([z.number(), z.string()]).optional(),
    gatewayToken: z.string().optional(),
    token: z.string().optional(),
    localUrl: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

type FleetCreateResult = {
  cellId: string;
  container: string;
  baseUrl: string;
  token: string;
};

async function fleetCreateCell(slug: string): Promise<FleetCreateResult> {
  const { stdout } = await execAsync(
    `openclaw fleet create ${JSON.stringify(slug)} --json`,
    { timeout: 120_000 }
  );
  const parsed = fleetCreateSchema.parse(JSON.parse(stdout));
  const container =
    parsed.container ?? parsed.containerName ?? parsed.name ?? parsed.tenantId ?? parsed.tenant;
  const cellId = parsed.tenantId ?? parsed.tenant ?? container ?? slug;
  const portRaw = parsed.hostPort ?? parsed.port;
  const baseUrl =
    parsed.localUrl ??
    parsed.url ??
    (portRaw ? `http://127.0.0.1:${portRaw}` : "");
  const token = parsed.gatewayToken ?? parsed.token ?? "";
  if (!container || !baseUrl || !token) {
    throw new Error(
      `openclaw fleet create --json returned an incomplete result: ${stdout.trim()}`
    );
  }
  return { cellId, container, baseUrl, token };
}

// ─────────────────────────── provisionCell ───────────────────────────

export type ProvisionedCell = {
  cellId: string;
  baseUrl: string;
  token: string;
};

// Provision (or re-provision) the tenant's OpenClaw cell and persist the
// connection on the Tenant row. Idempotent for "shared"; "fleet" creates a
// new container each call, so only call when the tenant has no cell yet.
export async function provisionCell(
  tenant: Tenant
): Promise<ProvisionedCell> {
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { cellStatus: "PENDING" },
  });

  try {
    let result: ProvisionedCell;
    if (PROVISIONING === "fleet") {
      const r = await fleetCreateCell(fleetSlug(tenant.slug));
      result = { cellId: r.cellId, baseUrl: r.baseUrl, token: r.token };
      // Remember the container on the cellId so agent provisioning can
      // docker-exec into it. Encode as `fleet:<container>`.
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          openclawCellId: `fleet:${r.container}`,
          openclawBaseUrl: r.baseUrl,
          openclawToken: r.token,
          cellStatus: "PROVISIONED",
        },
      });
    } else {
      result = {
        cellId: `shared:${tenant.id.slice(0, 8)}`,
        baseUrl: SHARED_BASE_URL,
        token: SHARED_TOKEN,
      };
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          openclawCellId: result.cellId,
          openclawBaseUrl: result.baseUrl,
          openclawToken: result.token,
          cellStatus: "PROVISIONED",
        },
      });
    }
    return result;
  } catch (err) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { cellStatus: "FAILED" },
    });
    throw err;
  }
}

// ─────────────────────────── provisionAgentInCell ───────────────────────────

export type ProvisionedAgent = { openclawAgentId: string };

// Create the agent inside the tenant's OpenClaw cell. In "fleet" mode this
// runs `openclaw agents add` inside the cell container, giving the agent its
// own workspace/sessions. In "shared" dev mode it targets the shared
// gateway's `default` agent (no per-agent isolation — dev only).
export async function provisionAgentInCell(
  tenant: Tenant,
  agent: Agent
): Promise<ProvisionedAgent> {
  const openclawAgentId = openclawAgentIdFor(agent);

  if (PROVISIONING === "fleet") {
    const cellRef = tenant.openclawCellId ?? "";
    // openclawCellId is encoded as `fleet:<container>` by provisionCell.
    if (!cellRef.startsWith("fleet:")) {
      throw new Error(
        `Cannot provision agent in fleet mode: tenant ${tenant.id} has no fleet container.`
      );
    }
    const container = cellRef.slice("fleet:".length);
    const workspace = `/home/node/.openclaw/agents/${openclawAgentId}/workspace`;
    const addCmd =
      `docker exec ${JSON.stringify(container)} openclaw agents add ` +
      `${JSON.stringify(openclawAgentId)} ` +
      `--workspace ${JSON.stringify(workspace)} ` +
      `--model ${JSON.stringify(AGENT_MODEL)} --non-interactive`;
    await execAsync(addCmd, { timeout: 120_000 }).catch((err) => {
      // `agents add` may surface a non-zero exit if the agent already exists;
      // treat "already exists" as success, rethrow real failures.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already exist/i.test(msg)) throw err;
    });
    // Structural topology change → restart the cell so the new agent loads.
    await execAsync(
      `docker exec ${JSON.stringify(container)} openclaw gateway restart`,
      { timeout: 60_000 }
    ).catch(() => {
      /* hybrid reload may already handle it; non-fatal */
    });
    return { openclawAgentId };
  }

  // shared (dev): no docker exec available; target the shared default agent.
  return { openclawAgentId: "default" };
}

export { AGENT_MODEL };
