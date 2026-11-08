// Assert-based self-check for the customer-identity scope guard (D2).
// Run: npx tsx scripts/self-check-scope.ts
// No database needed: resolveScopedPhone is a pure function; the ToolContext
// shape is minimal (the real context carries more fields, all optional).
import { resolveScopedPhone } from "../packages/core/src/tools/scope";
import type { ToolContext } from "../packages/core/src/types/tools";

type MinimalContext = Pick<ToolContext, "conversationId" | "customerPhone">;

function ctx(
  conversationId: string | undefined,
  customerPhone: string | undefined
): MinimalContext {
  return { conversationId, customerPhone };
}

const checks: Array<[string, boolean]> = [
  // Agent path: the conversation's phone, no matter what was requested.
  ["agent, no request -> conversation phone", resolveScopedPhone(ctx("c1", "628111"), undefined) === "628111"],
  ["agent, same phone -> allowed", resolveScopedPhone(ctx("c1", "628111"), "628111") === "628111"],
  ["agent, foreign phone -> DENIED", resolveScopedPhone(ctx("c1", "628111"), "628222") === null],
  ["agent, missing ctx phone -> denied (no identity to fall back to)", resolveScopedPhone(ctx("c1", undefined), "628222") === null],
  // HTTP gateway path (session-authenticated, no conversation): explicit phone is legitimate.
  ["gateway, explicit phone -> allowed", resolveScopedPhone(ctx(undefined, undefined), "628999") === "628999"],
  ["gateway, no phone at all -> null", resolveScopedPhone(ctx(undefined, undefined), undefined) === null],
  ["gateway, ctx phone fallback -> allowed", resolveScopedPhone(ctx(undefined, "628333"), undefined) === "628333"],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(ok ? "PASS" : "FAIL", "-", name);
  if (!ok) failed++;
}
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all scope checks passed");
