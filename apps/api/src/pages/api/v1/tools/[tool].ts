import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { executeTool } from "@csq/core/tools/execute";
import { requireApiAuth } from "@csq/core/lib/api-auth";
import { assignRequestId } from "@csq/core/lib/request-id";
import { checkRateLimit } from "@csq/core/lib/rate-limit";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import type { ApprovalPayload } from "@csq/core/types/tools";

// POST /api/v1/tools/[tool] - the agent-facing tool endpoint over the token
// realm (PRD 23C Phase 7). Body: { agentId, params }. Auth: a tenant API key
// (service tokens are not tenant-bound and get 403). tenantId always comes
// from the key - never the body. Execution is the same executeTool the
// agent loop uses in-process: tenant-scoped, permission-checked, audited.

const toolCallSchema = z.object({
  agentId: z.string().uuid(),
  params: z.record(z.string(), z.unknown()),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  assignRequestId(req, res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }

  const auth = await requireApiAuth(req);
  if (!auth) {
    res.setHeader("WWW-Authenticate", "Bearer");
    return res.status(401).json(apiError("UNAUTHORIZED", "API key required"));
  }
  if (auth.kind !== "API_KEY") {
    return res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Service tokens cannot execute tenant tools"));
  }
  if (!checkRateLimit(`tools:${auth.keyId}`, 60, 60_000)) {
    return res.status(429).json(apiError("RATE_LIMITED", "Too many requests"));
  }

  const toolName =
    typeof req.query.tool === "string" ? req.query.tool : undefined;
  if (!toolName) {
    return res.status(400).json(apiError("VALIDATION_ERROR", "Missing tool name"));
  }

  const parsed = toolCallSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(
        apiError(
          "VALIDATION_ERROR",
          parsed.error.issues[0]?.message ?? "Invalid request body"
        )
      );
  }
  const { agentId, params } = parsed.data;

  // The agent must belong to the key's tenant - a key can never drive
  // another tenant's agent.
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { tenantId: true },
  });
  if (!agent || agent.tenantId !== auth.tenantId) {
    return res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Agent does not belong to your tenant"));
  }

  const outcome = await executeTool({
    toolName,
    tenantId: auth.tenantId,
    agentId,
    params,
  });

  switch (outcome.kind) {
    case "ok": {
      if (outcome.result.success) {
        return res.status(200).json(apiOk(outcome.result.data ?? null));
      }
      // Handler-reported business failure (NOT_FOUND, insufficient stock, ...).
      const code = outcome.result.errorCode ?? "INTERNAL_ERROR";
      const status =
        code === "NOT_FOUND" ? 404 : code === "VALIDATION_ERROR" ? 400 : 500;
      return res
        .status(status)
        .json(apiError(code, outcome.result.error ?? "Tool failed"));
    }
    case "tool_not_found":
      return res
        .status(404)
        .json(apiError("TOOL_NOT_FOUND", `Tool not found: ${toolName}`));
    case "not_found":
      return res.status(404).json(apiError("NOT_FOUND", outcome.message));
    case "validation_error":
      return res.status(400).json(apiError("VALIDATION_ERROR", outcome.message));
    case "permission_denied":
      return res
        .status(403)
        .json(
          apiError(
            "PERMISSION_DENIED",
            `Agent does not have permission for ${toolName}`
          )
        );
    case "approval_required": {
      // success:false carries data alongside (the approval payload) - SDD §5.1.
      const body: ApiResponse<ApprovalPayload> = {
        success: false,
        error: {
          code: "APPROVAL_REQUIRED",
          message: "This action requires owner approval",
        },
        data: outcome.payload,
      };
      return res.status(403).json(body);
    }
    case "internal_error":
      return res.status(500).json(apiError("INTERNAL_ERROR", outcome.message));
  }
}
