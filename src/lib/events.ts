import { EventEmitter } from "events";
import { z } from "zod";

// In-process scenario event bus. The codebase has no pubsub/queue (single
// Next.js process, no Redis per the stack decision), so triggers dispatch
// through a typed EventEmitter here. This is the single chokepoint that the
// webhook, the tool gateway, and the tag-application path emit into, and the
// scenario engine subscribes to — keeping emission decoupled from execution
// and avoiding scattered direct calls.
//
// `emit` is fire-and-forget: it validates the payload with Zod, then invokes
// each handler without awaiting it (so a slow scenario run never blocks the
// webhook ACK or the tool call). Handler errors are caught and logged per-
// handler so one failing subscriber cannot crash another or the emitter.

// ─────────────────────────── Payloads ───────────────────────────

const conversationNewSchema = z.object({
  tenantId: z.string(),
  conversationId: z.string(),
  channelId: z.string(),
  customerPhone: z.string(),
  customerName: z.string().optional(),
});

const orderPurchasedSchema = z.object({
  tenantId: z.string(),
  orderId: z.string(),
  // Routing context — present when the order was created from a conversation
  // (the agent loop passes conversationId/customerPhone into the tool).
  conversationId: z.string().optional(),
  customerPhone: z.string().optional(),
  customerName: z.string().optional(),
  // Decimal serializes as string; carry it as-is for interpolation + conditions.
  orderTotal: z.string(),
  orderItems: z.array(
    z.object({ productName: z.string(), quantity: z.number().int().positive() })
  ),
});

const conversationTaggedSchema = z.object({
  tenantId: z.string(),
  conversationId: z.string(),
  tagName: z.string(),
  tagId: z.string(),
});

export type ConversationNewEvent = z.infer<typeof conversationNewSchema>;
export type OrderPurchasedEvent = z.infer<typeof orderPurchasedSchema>;
export type ConversationTaggedEvent = z.infer<typeof conversationTaggedSchema>;

export type ScenarioEventName =
  | "conversation.new"
  | "order.purchased"
  | "conversation.tagged";

// Map each event name to its schema for boundary validation in emit().
const schemas = {
  "conversation.new": conversationNewSchema,
  "order.purchased": orderPurchasedSchema,
  "conversation.tagged": conversationTaggedSchema,
} as const;

// ─────────────────────────── Bus ───────────────────────────

type EventHandler<P> = (payload: P) => Promise<void> | void;

type EventPayload<N extends ScenarioEventName> =
  N extends "conversation.new"
    ? ConversationNewEvent
    : N extends "order.purchased"
      ? OrderPurchasedEvent
      : ConversationTaggedEvent;

class ScenarioEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // A scenario trigger fan-out can start many runs; raise the default
    // listener cap so a large active-scenario set never hits the warning.
    this.emitter.setMaxListeners(50);
  }

  on<N extends ScenarioEventName>(
    name: N,
    handler: EventHandler<EventPayload<N>>
  ): void {
    this.emitter.on(name, handler as (...args: unknown[]) => void);
  }

  // Validate the payload, then invoke each handler fire-and-forget. Never
  // throws to the caller: a bad payload or a throwing handler is logged and
  // swallowed so the emission point (webhook/tool) is unaffected.
  emit<N extends ScenarioEventName>(name: N, raw: unknown): void {
    const schema = schemas[name];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        `[events] ${name} payload failed validation; dropping event:`,
        parsed.error.issues
      );
      return;
    }
    const payload = parsed.data;
    const handlers = this.emitter.listeners(name) as Array<
      (p: unknown) => Promise<void> | void
    >;
    for (const handler of handlers) {
      try {
        const maybe = handler(payload);
        if (maybe && typeof (maybe as Promise<void>).then === "function") {
          (maybe as Promise<void>).catch((err: unknown) => {
            console.error(`[events] ${name} handler threw:`, err);
          });
        }
      } catch (err) {
        console.error(`[events] ${name} handler threw synchronously:`, err);
      }
    }
  }
}

// Single shared instance. Modules import `events` and call on()/emit().
export const events = new ScenarioEventBus();
