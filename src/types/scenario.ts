import { z } from "zod";

// Scenario graph types + Zod schemas. The source of truth for the visual
// drag-and-drop builder, the API boundary, and the execution engine. Every
// graph that enters the system (API POST/PUT, runtime load) is parsed with
// these schemas — no `as` narrowing, no trusting raw JSON.
//
// Node set (v1): trigger, send, wait, condition, tag, end. Fire-and-forget:
// the scenario injects outbound messages at trigger times and never owns the
// conversation; the AI agent handles any customer reply as normal.

// ─────────────────────────── Enums ───────────────────────────

export const triggerTypeSchema = z.enum([
  "ON_NEW_CONVERSATION",
  "ON_PURCHASE",
  "ON_TAG_ADDED",
]);
export type ScenarioTriggerType = z.infer<typeof triggerTypeSchema>;

export const scenarioStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED"]);
export type ScenarioStatus = z.infer<typeof scenarioStatusSchema>;

export const runStatusSchema = z.enum([
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
]);
export type ScenarioRunStatus = z.infer<typeof runStatusSchema>;

export const conditionOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "greater_than",
  "less_than",
  "is_set",
  "is_not_set",
]);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

// ─────────────────────────── Node data ───────────────────────────

// Trigger node (exactly one per graph, the start). triggerType drives which
// event starts a run; tagName is required when triggerType = ON_TAG_ADDED
// (enforced in validateScenarioGraph, not the schema, so the discriminated
// union stays clean).
export const triggerNodeDataSchema = z.object({
  triggerType: triggerTypeSchema,
  tagName: z.string().min(1).optional(),
});

// Send a WhatsApp message (free text + {{variable}} interpolation). On Cloud
// API the runtime enforces the 24h customer-service window; out-of-window
// sends are skipped + audited, never silently dropped or sent into a reject.
export const sendNodeDataSchema = z.object({
  body: z.string().min(1).max(4096),
});

// Pause the run until resumeAt = now + durationMs. Persisted (not an in-memory
// timer) so process restarts/deployments don't lose it; node-cron resumes.
export const waitNodeDataSchema = z.object({
  durationMs: z.number().int().positive().max(30 * 24 * 60 * 60 * 1000),
});

// The only branching point. Two outgoing edges: sourceHandle "true" / "false".
// `field` resolves from the run context (order_total, customer_name, a tag…).
export const conditionNodeDataSchema = z.object({
  field: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.string(),
});

// Add a tag to the conversation (auto-creates the Tag row for the tenant).
export const tagNodeDataSchema = z.object({
  tagName: z.string().min(1),
});

export const endNodeDataSchema = z.object({});

// ─────────────────────────── Graph ───────────────────────────

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const scenarioNodeSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("trigger"),
    position: positionSchema,
    data: triggerNodeDataSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("send"),
    position: positionSchema,
    data: sendNodeDataSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("wait"),
    position: positionSchema,
    data: waitNodeDataSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("condition"),
    position: positionSchema,
    data: conditionNodeDataSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("tag"),
    position: positionSchema,
    data: tagNodeDataSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("end"),
    position: positionSchema,
    data: endNodeDataSchema,
  }),
]);
export type ScenarioNode = z.infer<typeof scenarioNodeSchema>;

export const scenarioEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  // Condition nodes branch on sourceHandle "true" / "false". Other nodes have
  // a single outgoing edge with no sourceHandle.
  sourceHandle: z.enum(["true", "false"]).optional(),
});
export type ScenarioEdge = z.infer<typeof scenarioEdgeSchema>;

export const scenarioGraphSchema = z.object({
  nodes: z.array(scenarioNodeSchema),
  edges: z.array(scenarioEdgeSchema),
});
export type ScenarioGraph = z.infer<typeof scenarioGraphSchema>;

// ─────────────────────────── Trigger config (Scenario column) ───────────────────────────
// Stored separately on the Scenario row so the engine can find active scenarios
// for an event without parsing the JSON graph (indexed triggerType column).
export const triggerConfigSchema = z.object({
  tagName: z.string().min(1).optional(),
});
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

// ─────────────────────────── Run context ───────────────────────────
// The variable payload the trigger event injects; `{{variable}}` in Send node
// bodies resolves against this. Values are primitives only — never objects —
// so interpolation can't leak structured data or injection payloads.
export const runContextSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);
export type RunContext = z.infer<typeof runContextSchema>;

// ─────────────────────────── Client-facing shape ───────────────────────────
// Prisma serializes DateTime → ISO string and enums → string. This mirrors the
// JSON the browser receives (see src/types/dashboard.ts for the convention).
export type Scenario = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: ScenarioStatus;
  triggerType: ScenarioTriggerType;
  triggerConfig: TriggerConfig;
  graph: ScenarioGraph;
  version: number;
  createdAt: string;
  updatedAt: string;
};
