import { z } from "zod";

// Typed scenario event bus. The codebase has no pubsub/queue (single
// Next.js process, no Redis per the stack decision), so triggers dispatch
// through typed channels here. This is the single chokepoint that the
// webhook, the tool gateway, and the tag-application path emit into, and
// the scenario engine subscribes to - keeping emission decoupled from
// execution and avoiding scattered direct calls.
//
// D10e: channels replace the old EventEmitter wrapper. `emit` validates the
// payload with Zod and invokes each handler without awaiting it (a slow
// scenario run never blocks the webhook ACK or the tool call). Handler
// errors are caught and logged per-handler so one failing subscriber cannot
// crash another or the emitter. Each channel's handler signature is derived
// from its schema, so the whole module is cast-free.

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
  // Routing context - present when the order was created from a conversation
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

// ─────────────────────────── Channel ───────────────────────────

class TypedChannel<S extends z.ZodTypeAny> {
  private readonly handlers: Array<(p: z.output<S>) => void> = [];

  constructor(private readonly schema: S) {}

  on(handler: (p: z.output<S>) => void): void {
    this.handlers.push(handler);
  }

  // Validate the payload, then invoke each handler fire-and-forget. Never
  // throws to the caller: a bad payload or a throwing handler is logged and
  // swallowed so the emission point (webhook/tool) is unaffected.
  emit(raw: unknown): void {
    const parsed = this.schema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        "[events] payload failed validation; dropping event:",
        parsed.error.issues
      );
      return;
    }
    const payload = parsed.data;
    for (const handler of this.handlers) {
      try {
        // Handlers may return void or a Promise; boxing through unknown keeps
        // the check cast-free (void is not a valid instanceof LHS).
        const maybe: unknown = handler(payload);
        if (maybe instanceof Promise) {
          maybe.catch((err: unknown) => {
            console.error("[events] handler rejected:", err);
          });
        }
      } catch (err) {
        console.error("[events] handler threw synchronously:", err);
      }
    }
  }
}

// ─────────────────────────── Bus ───────────────────────────
// One typed channel per event; emit() validates, on() is fully typed.

export const events = {
  conversationNew: new TypedChannel(conversationNewSchema),
  orderPurchased: new TypedChannel(orderPurchasedSchema),
  conversationTagged: new TypedChannel(conversationTaggedSchema),
};
