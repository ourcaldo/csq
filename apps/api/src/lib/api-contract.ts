import { z } from "zod";

// Single source of truth for the /api/v1 contract (PRD 09, Generated OpenAPI).
// The route handlers import these request schemas, and the OpenAPI document is
// built from the same definitions. A shape change here changes both.

export const authTokenRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const refreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(10).max(200),
});

export const toolCallRequestSchema = z.object({
  agentId: z.string().uuid(),
  params: z.record(z.string(), z.unknown()),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const logoutResultSchema = z.object({ revoked: z.boolean() });
export type LogoutResult = z.infer<typeof logoutResultSchema>;

export const toolPermissionSchema = z.object({
  allowed: z.boolean(),
  requiresApproval: z.boolean(),
});

// Mirrors ToolSummary in packages/core/src/types/tools.ts.
export const toolSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.string(),
  defaultPermission: toolPermissionSchema,
});

// Mirrors WebhookDiag in packages/core/src/lib/webhook-diagnostics.ts.
export const webhookDiagSchema = z.object({
  at: z.string(),
  kind: z.enum(["SIG_MISMATCH", "NO_SECRET", "UNKNOWN_PHONE_ID"]),
  phoneId: z.string().optional(),
  receivedSig: z.string().optional(),
  computedSig: z.string().optional(),
});

export type ApiSecurity = "none" | "bearer" | "service";

export type ApiOperation = {
  method: "get" | "post";
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  security: ApiSecurity;
  request?: z.ZodTypeAny;
  parameters?: {
    name: string;
    in: "path";
    required: boolean;
    description?: string;
    schema: z.ZodTypeAny;
  }[];
  responses: Record<
    string,
    {
      description: string;
      /** JSON response data; the generator wraps it in the ApiResponse envelope. */
      data?: z.ZodTypeAny;
      /** Raw response body for non-JSON endpoints (binary media). */
      raw?: Record<string, unknown>;
      contentType?: string;
    }
  >;
};

export const API_OPERATIONS: ApiOperation[] = [
  {
    method: "post",
    path: "/api/v1/auth/token",
    summary: "Exchange email and password for an access JWT and refresh token",
    tags: ["Auth"],
    security: "none",
    request: authTokenRequestSchema,
    responses: {
      "200": { description: "Access and refresh token pair", data: tokenPairSchema },
      "400": { description: "Invalid payload" },
      "401": { description: "Invalid credentials" },
      "403": { description: "Account is not linked to a tenant" },
      "429": { description: "Rate limited (5 requests per minute per IP)" },
    },
  },
  {
    method: "post",
    path: "/api/v1/auth/refresh",
    summary: "Rotate a refresh token for a fresh pair",
    description: "The presented refresh token is always revoked. Replaying a used token returns 401.",
    tags: ["Auth"],
    security: "none",
    request: refreshTokenRequestSchema,
    responses: {
      "200": { description: "New token pair", data: tokenPairSchema },
      "400": { description: "Invalid payload" },
      "401": { description: "Invalid, expired, or already rotated token" },
      "429": { description: "Rate limited (20 requests per minute per IP)" },
    },
  },
  {
    method: "post",
    path: "/api/v1/auth/logout",
    summary: "Revoke a refresh token (idempotent)",
    tags: ["Auth"],
    security: "none",
    request: refreshTokenRequestSchema,
    responses: {
      "200": { description: "Revoked", data: logoutResultSchema },
      "400": { description: "Invalid payload" },
    },
  },
  {
    method: "get",
    path: "/api/v1/tools",
    summary: "List registered tools",
    tags: ["Tools"],
    security: "bearer",
    responses: {
      "200": { description: "Tool summaries", data: z.array(toolSummarySchema) },
      "401": { description: "Bearer token required" },
    },
  },
  {
    method: "post",
    path: "/api/v1/tools/{tool}",
    summary: "Execute a tool",
    description:
      "Tenant API keys and user access JWTs may execute tools. Service tokens cannot. The agent must belong to the token's tenant.",
    tags: ["Tools"],
    security: "bearer",
    parameters: [
      {
        name: "tool",
        in: "path",
        required: true,
        description: "Registered tool name",
        schema: z.string(),
      },
    ],
    request: toolCallRequestSchema,
    responses: {
      "200": { description: "Tool result", data: z.unknown() },
      "400": { description: "Invalid payload or tool validation error" },
      "401": { description: "Bearer token required" },
      "403": {
        description:
          "Permission denied, service token used, agent from another tenant, or approval required (data carries the approval payload)",
      },
      "404": { description: "Tool or entity not found" },
      "429": { description: "Rate limited (60 requests per minute per key)" },
      "500": { description: "Tool execution failed" },
    },
  },
  {
    method: "get",
    path: "/api/v1/webhook-diag",
    summary: "Recent webhook rejection diagnostics",
    description: "Service-token only. Memory-only entries, capped and reset on deploy.",
    tags: ["Operations"],
    security: "service",
    responses: {
      "200": {
        description: "Diagnostic entries",
        data: z.object({ items: z.array(webhookDiagSchema) }),
      },
      "401": { description: "Bearer token required" },
      "403": { description: "Service token required" },
    },
  },
  {
    method: "get",
    path: "/api/media/{id}",
    summary: "Fetch a stored media asset",
    description:
      "Unauthenticated by design: Meta's Cloud API fetcher must reach the image. The unguessable UUID is the access control; responses are immutable and cached for one year.",
    tags: ["Media"],
    security: "none",
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        description: "Media asset UUID",
        schema: z.string().uuid(),
      },
    ],
    responses: {
      "200": {
        description: "Stored bytes with the asset's MIME type",
        raw: { type: "string", format: "binary" },
        contentType: "application/octet-stream",
      },
      "404": {
        description: "Asset not found",
        raw: { type: "string" },
        contentType: "text/plain",
      },
    },
  },
];
