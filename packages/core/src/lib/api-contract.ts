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
  method: "get" | "post" | "patch";
  path: string;
  /** Stable docs URL slug (docs pages must not change when paths change). */
  slug: string;
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

// Outbound messaging API (PRD 24): send a text, an image, an image with a
// caption, or a document through the tenant's connected channel. `text`
// becomes the caption when `media` is present.
export const sendMessageRequestSchema = z
  .object({
    to: z
      .string()
      .min(8)
      .max(20)
      .regex(/^\+?[0-9]+$/, "to must be digits with an optional leading +"),
    text: z.string().min(1).max(4096).optional(),
    media: z
      .object({
        url: z.string().url().max(2048),
        // Amendment 2026-11-18: documents. `image` (default) sends an image
        // message; `document` sends a document and REQUIRES `filename` (the
        // name the customer sees on the bubble, max 120 chars).
        kind: z.enum(["image", "document"]).default("image"),
        filename: z.string().min(1).max(120).optional(),
      })
      .refine((m) => m.kind !== "document" || !!m.filename, {
        message: "filename is required for document media",
        path: ["filename"],
      })
      .optional(),
    // Required by design (owner decision 2026-11-15): tenants will run
    // multiple channels, so the sender must be explicit about which one.
    // The dashboard's Saluran page shows the channel ID with a copy button.
    channelId: z.string().uuid(),
    // Lead source (amendment 2026-11-16): what brought this customer in, e.g.
    // "Placement Test". Stored on the contact and shown on the pipeline card.
    // An explicit source always updates it; without one, a first contact falls
    // back to the API key's name, then "API".
    source: z.string().trim().min(1).max(80).optional(),
  })
  .refine((value) => Boolean(value.text) || Boolean(value.media), {
    message: "text or media is required",
    path: ["text"],
  });

export const sendMessageResultSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  channelId: z.string(),
  waMessageId: z.string().optional(),
});

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type SendMessageResult = z.infer<typeof sendMessageResultSchema>;

// Pipeline management API (PRD 25): list / move / create deals on the
// tenant's sales pipeline from tenant systems - the same core pipeline
// functions, history rows, and audit trail as the dashboard.
export const pipelineStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["OPENING", "NORMAL", "WON", "LOST"]),
  order: z.number().int(),
});
export type PipelineStageDto = z.infer<typeof pipelineStageSchema>;

export const pipelineDealsQuerySchema = z.object({
  stage: z.string().trim().min(1).max(60).optional(),
  assignee: z.string().uuid().optional(),
  tag: z.string().trim().min(1).max(60).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const pipelineDealSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  value: z.number().int(),
  stage: pipelineStageSchema,
  conversation: z.object({
    id: z.string(),
    customerPhone: z.string(),
    lastMessageAt: z.string().nullable(),
    contact: z
      .object({
        id: z.string(),
        name: z.string().nullable(),
        phone: z.string(),
        source: z.string().nullable(),
      })
      .nullable(),
    assignee: z
      .object({ id: z.string(), name: z.string().nullable(), email: z.string() })
      .nullable(),
    tags: z.array(z.object({ tag: z.object({ id: z.string(), name: z.string() }) })),
  }),
});
export type PipelineDealDto = z.infer<typeof pipelineDealSchema>;

export const pipelineDealsResultSchema = z.object({
  items: z.array(pipelineDealSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PipelineDealsResult = z.infer<typeof pipelineDealsResultSchema>;

export const pipelineStagesResultSchema = z.object({
  items: z.array(pipelineStageSchema),
});

export const dealPatchRequestSchema = z
  .object({
    stage: z.string().trim().min(1).max(60).optional(),
    value: z.number().int().min(0).max(1_000_000_000_000).optional(),
    reason: z.string().max(300).optional(),
  })
  .refine((v) => v.stage !== undefined || v.value !== undefined, {
    message: "stage or value is required",
    path: ["stage"],
  });
export type DealPatchRequest = z.infer<typeof dealPatchRequestSchema>;

export const dealPatchResultSchema = z.object({
  dealId: z.string(),
  stageId: z.string().optional(),
  value: z.number().int().optional(),
});
export type DealPatchResult = z.infer<typeof dealPatchResultSchema>;

export const createDealRequestSchema = z.object({
  phone: z.string().min(8).max(25),
  name: z.string().max(120).optional(),
  stage: z.string().trim().min(1).max(60).optional(),
  value: z.number().int().min(0).max(1_000_000_000_000).optional(),
});
export type CreateDealRequest = z.infer<typeof createDealRequestSchema>;

export const createDealResultSchema = z.object({
  conversationId: z.string(),
  dealId: z.string(),
  created: z.boolean(),
});
export type CreateDealResult = z.infer<typeof createDealResultSchema>;

export const API_OPERATIONS: ApiOperation[] = [
  {
    method: "post",
    path: "/api/v1/auth/token",
    slug: "auth-token",
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
    slug: "auth-refresh",
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
    slug: "auth-logout",
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
    slug: "tools-list",
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
    slug: "tools-execute",
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
    method: "post",
    path: "/api/v1/messages",
    slug: "messages-send",
    summary: "Send a WhatsApp message",
    description:
      "Sends a text message, an image (with optional caption), or a document (media.kind \"document\", filename required) through the channel named by channelId (required - tenants can run multiple channels). Optional source labels where the lead came from (e.g. \"Placement Test\"); it is stored on the contact and shown on the pipeline card. Recorded in the inbox conversation and audited; the agent keeps owning the conversation (no takeover). On the Cloud API, free-form sends are only allowed within 24 hours of the customer's last inbound message.",
    tags: ["Messages"],
    security: "bearer",
    request: sendMessageRequestSchema,
    responses: {
      "200": { description: "Message sent and recorded", data: sendMessageResultSchema },
      "400": { description: "Invalid payload, or the media URL is not fetchable" },
      "401": { description: "Bearer token required" },
      "403": { description: "Service token used, or channel outside your tenant" },
      "409": { description: "No connected WhatsApp channel" },
      "422": { description: "Cloud API 24h window closed - an approved template is required" },
      "429": { description: "Rate limited (60 requests per minute per credential)" },
      "502": { description: "Provider send failed" },
    },
  },
  {
    method: "get",
    path: "/api/v1/pipeline/deals",
    slug: "pipeline-deals-list",
    summary: "List pipeline deals",
    description:
      "The tenant's pipeline board (PRD 25): deals with stage, value, contact, source, assignee, and tags. Filters: stage name, assignee user UUID, tag name, chat-activity date range, pagination. Requires the pipeline feature on the tenant's plan.",
    tags: ["Pipeline"],
    security: "bearer",
    parameters: [
      { name: "stage", in: "path", required: false, description: "Stage name filter", schema: z.string() },
      { name: "assignee", in: "path", required: false, description: "Assignee user UUID filter", schema: z.string().uuid() },
      { name: "tag", in: "path", required: false, description: "Tag name filter", schema: z.string() },
      { name: "from", in: "path", required: false, description: "Chat activity from (ISO date)", schema: z.string() },
      { name: "to", in: "path", required: false, description: "Chat activity to (ISO date)", schema: z.string() },
      { name: "page", in: "path", required: false, description: "Page number (default 1)", schema: z.number().int() },
      { name: "pageSize", in: "path", required: false, description: "Page size (default 50, max 100)", schema: z.number().int() },
    ],
    responses: {
      "200": { description: "Deal page", data: pipelineDealsResultSchema },
      "400": { description: "Invalid query parameters" },
      "401": { description: "Bearer token required" },
      "403": { description: "Service token used, or the pipeline feature is not on the tenant's plan" },
      "404": { description: "Unknown stage name filter" },
      "429": { description: "Rate limited (60 requests per minute per credential)" },
    },
  },
  {
    method: "get",
    path: "/api/v1/pipeline/stages",
    slug: "pipeline-stages-list",
    summary: "List pipeline stages",
    description:
      "The tenant's pipeline stages (id, name, kind, order) so a caller can discover valid stage names before moving a deal (PRD 25).",
    tags: ["Pipeline"],
    security: "bearer",
    responses: {
      "200": { description: "Stage list", data: pipelineStagesResultSchema },
      "401": { description: "Bearer token required" },
      "403": { description: "Service token used, or the pipeline feature is not on the tenant's plan" },
      "429": { description: "Rate limited (60 requests per minute per credential)" },
    },
  },
  {
    method: "patch",
    path: "/api/v1/pipeline/deals/{conversationId}",
    slug: "pipeline-deal-update",
    summary: "Move a deal's stage or set its value",
    description:
      "Same behavior as the dashboard drawer (PRD 25): moving to a stage name (case-insensitive; terminal stages Menang/Kalah cannot be moved out of) writes the stage history row and audit; setting the value audits deal.value_change. A conversation without a deal gets one lazily. At least one of stage / value is required.",
    tags: ["Pipeline"],
    security: "bearer",
    parameters: [
      {
        name: "conversationId",
        in: "path",
        required: true,
        description: "Conversation UUID",
        schema: z.string().uuid(),
      },
    ],
    request: dealPatchRequestSchema,
    responses: {
      "200": { description: "Updated deal", data: dealPatchResultSchema },
      "400": { description: "Invalid body" },
      "401": { description: "Bearer token required" },
      "403": { description: "Service token used, or the pipeline feature is not on the tenant's plan" },
      "404": { description: "Conversation or stage not found for this tenant" },
      "429": { description: "Rate limited (60 requests per minute per credential)" },
    },
  },
  {
    method: "post",
    path: "/api/v1/pipeline/deals",
    slug: "pipeline-deal-create",
    summary: "Create a lead",
    description:
      "Same as the dashboard's manual lead entry (PRD 25): normalize the phone (08xx to 628xx), reuse the existing conversation for that number instead of duplicating, place the deal on the given (or first) stage, optionally set the contact name and value.",
    tags: ["Pipeline"],
    security: "bearer",
    request: createDealRequestSchema,
    responses: {
      "200": { description: "Lead placed on the pipeline", data: createDealResultSchema },
      "400": { description: "Invalid body or phone" },
      "401": { description: "Bearer token required" },
      "403": { description: "Service token used, or the pipeline feature is not on the tenant's plan" },
      "404": { description: "Unknown stage name" },
      "429": { description: "Rate limited (60 requests per minute per credential)" },
    },
  },
  {
    method: "get",
    path: "/api/v1/webhook-diag",
    slug: "webhook-diag",
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
    slug: "media-get",
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
  {
    // OPS-6 (PRD 16): the infra surface is documented too - health, the
    // spec itself, and the Meta webhook live on this service.
    method: "get",
    path: "/api/health",
    slug: "health",
    summary: "Liveness and database connectivity probe",
    description:
      "Used by the platform health checks and the alert cron. Also the boot hook for this process's scenario-engine event subscription.",
    tags: ["Operations"],
    security: "none",
    responses: {
      "200": {
        description: "Status envelope with the database state",
        data: z.object({ status: z.string(), db: z.string() }),
      },
      "405": { description: "Method not allowed" },
    },
  },
  {
    method: "get",
    path: "/api/v1/openapi",
    slug: "openapi",
    summary: "This OpenAPI document",
    tags: ["Operations"],
    security: "none",
    responses: {
      "200": {
        description: "The generated OpenAPI 3.0 document",
        raw: { type: "object" },
        contentType: "application/json",
      },
    },
  },
  {
    method: "get",
    path: "/api/webhooks/whatsapp",
    slug: "webhooks-verify",
    summary: "Meta webhook verification handshake",
    description:
      "Meta calls this once when the callback URL is configured. The hub.verify_token must match a CLOUD_API channel's stored verify token.",
    tags: ["Webhooks"],
    security: "none",
    responses: {
      "200": {
        description: "The hub.challenge value echoed as text",
        raw: { type: "string" },
        contentType: "text/plain",
      },
      "403": {
        description: "Verification failed",
        raw: { type: "string" },
        contentType: "text/plain",
      },
    },
  },
  {
    method: "post",
    path: "/api/webhooks/whatsapp",
    slug: "webhooks-events",
    summary: "Meta webhook inbound events",
    description:
      "Inbound Cloud API messages and status updates. Signature-verified (X-Hub-Signature-256, fail-closed); always acknowledged 200 quickly per Meta's 5 second requirement. Inbound messages are ingested and the agent turn runs fire-and-forget.",
    tags: ["Webhooks"],
    security: "none",
    responses: {
      "200": {
        description: "Event received (always, for parseable payloads)",
        raw: { type: "string" },
        contentType: "text/plain",
      },
      "401": {
        description: "Missing app secret or signature mismatch",
        raw: { type: "string" },
        contentType: "text/plain",
      },
      "429": {
        description: "Per-IP burst limit exceeded",
        raw: { type: "string" },
        contentType: "text/plain",
      },
    },
  },
];
