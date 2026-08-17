import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { executeTool } from "@/tools/execute";
import { apiError, apiOk, type ApiResponse } from "@/types/api";
import type { ApprovalPayload } from "@/types/tools";

// POST /api/tools/[tool] — the agent-facing tool endpoint (SDD §5.2).
// Body: { agentId, params }. Auth: a dashboard session OR the OpenClaw API key
// (x-openclaw-api-key header matching OPENCLAW_API_KEY). tenantId is ALWAYS
// resolved server-side — from the session, or from the Agent record behind the
// agentId — never from the request body or conversation content.

const toolCallSchema = z.object({
  agentId: z.string().uuid(),
  params: z.record(z.string(), z.unknown()),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
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

  // Resolve tenantId. Session path also verifies the agentId belongs to the
  // same tenant (prevents a session user driving another tenant's agent).
  let tenantId: string | null = null;
  const session = await getAuthSession(req, res);
  if (session) {
    tenantId = session.user.tenantId;
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { tenantId: true },
    });
    if (!agent || agent.tenantId !== tenantId) {
      return res
        .status(403)
        .json(
          apiError("PERMISSION_DENIED", "Agent does not belong to your tenant")
        );
    }
  } else {
    const key = req.headers["x-openclaw-api-key"];
    const expected = process.env.OPENCLAW_API_KEY;
    if (expected && typeof key === "string" && key === expected) {
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { tenantId: true },
      });
      if (agent) {
        tenantId = agent.tenantId;
      }
    }
  }
  if (!tenantId) {
    return res.status(401).json(apiError("UNAUTHORIZED", "Authentication required"));
  }

  const outcome = await executeTool({ toolName, tenantId, agentId, params });

  switch (outcome.kind) {
    case "ok": {
      if (outcome.result.success) {
        return res.status(200).json(apiOk(outcome.result.data ?? null));
      }
      // Handler-reported business failure (NOT_FOUND, insufficient stock, …).
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
      // success:false carries data alongside (the approval payload) — SDD §5.1.
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
