import type { ToolContext } from "@/types/tools";

// Customer-identity scope for agent tools (PRD 18.1: "enforce
// customer-specific data scope server-side").
//
// Two entry paths reach a tool:
//   - the AGENT path: ctx.conversationId is always set and the customer's
//     phone was resolved from the conversation by the caller (never by the
//     model) - the model must not be able to redirect a lookup at another
//     customer;
//   - the HTTP gateway (/api/tools/[tool]): a session-authenticated
//     dashboard path with no conversation, where an explicit phone is
//     legitimate.
//
// In the agent path, any requested phone that differs from the conversation's
// phone is rejected (returns null). The caller turns null into a
// PERMISSION_DENIED ToolResult. Scope is enforced here in code - never by
// prompt text.

// Declares exactly what the guard reads: the routing context the caller
// resolved (never the model). `Pick` keeps the self-check DB-free and makes
// the function's inputs explicit.
export function resolveScopedPhone(
  ctx: Pick<ToolContext, "conversationId" | "customerPhone">,
  requested?: string
): string | null {
  if (!ctx.conversationId) {
    // HTTP gateway path: no conversation context, the session carries the trust.
    return requested ?? ctx.customerPhone ?? null;
  }
  // Agent path: identity is the conversation, nothing else.
  if (requested && requested !== ctx.customerPhone) return null;
  return ctx.customerPhone ?? null;
}
