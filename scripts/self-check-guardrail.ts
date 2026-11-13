import assert from "assert";
import {
  preBlocked,
  postFlagged,
  guardMode,
  PRE_BLOCK_STORE_INTENT_MAX,
  PRE_BLOCK_INJECTION_MIN,
  POST_FLAG_GROUNDED_MAX,
  POST_FLAG_ON_TOPIC_MAX,
  POST_FLAG_REVEALS_MIN,
} from "@csq/core/lib/guardrail";

// Guardrail self-check (PRD 03 amendment 2026-11-13). Asserts the pure
// threshold logic against the measured 2026-11-13 pilot values; the Decisions
// API client itself was validated live in that pilot. No DB, no network:
//   npm run check:guardrail

// Mode parsing: unknown/empty -> shadow (safe default: log-only).
const savedMode = process.env.GUARD_MODE;
process.env.GUARD_MODE = "";
assert.strictEqual(guardMode(), "shadow");
process.env.GUARD_MODE = "nonsense";
assert.strictEqual(guardMode(), "shadow");
process.env.GUARD_MODE = "off";
assert.strictEqual(guardMode(), "off");
process.env.GUARD_MODE = "enforce";
assert.strictEqual(guardMode(), "enforce");
if (savedMode === undefined) delete process.env.GUARD_MODE;
else process.env.GUARD_MODE = savedMode;

// Pre-turn: pilot on-topic messages (0.96-0.99) never block; off-topic
// (0.01-0.02) and injection (0.99) do; mixed passes to the reply-side check.
assert.strictEqual(preBlocked(0.9858, 0.01), false); // "kopi arabikanya masih ada?"
assert.strictEqual(preBlocked(0.9616, 0.01), false); // "bayar transfer bank bisa ga?"
assert.strictEqual(preBlocked(0.01, 0.01), true); // hello world request
assert.strictEqual(preBlocked(0.0244, 0.01), true); // recipe request
assert.strictEqual(preBlocked(0.85, 0.01), false); // mixed: reply side governs
assert.strictEqual(preBlocked(0.07, 0.99), true); // jailbreak
assert.strictEqual(preBlocked(0.99, 0.99), true); // injection fires even with store wording
// Boundaries: at-threshold blocks, one step above passes.
assert.strictEqual(preBlocked(PRE_BLOCK_STORE_INTENT_MAX, 0.01), true);
assert.strictEqual(preBlocked(PRE_BLOCK_STORE_INTENT_MAX + 0.001, 0.01), false);
assert.strictEqual(preBlocked(0.99, PRE_BLOCK_INJECTION_MIN), true);
assert.strictEqual(preBlocked(0.99, PRE_BLOCK_INJECTION_MIN - 0.001), false);

// Post-turn: pilot values - a grounded reply passes; fabricated prices,
// scope drift, and model-name leaks flag.
assert.strictEqual(postFlagged(0.72, 0.99, 0.01), false);
assert.strictEqual(postFlagged(0.013, 0.93, 0.047), true); // fabricated price
assert.strictEqual(postFlagged(0.35, 0.027, 0.06), true); // recipe drift
assert.strictEqual(postFlagged(0.62, 0.23, 0.95), true); // model-name leak
assert.strictEqual(postFlagged(0.31, 0.5, 0.01), false); // just above every threshold
assert.strictEqual(postFlagged(POST_FLAG_GROUNDED_MAX, 0.9, 0.01), true);
assert.strictEqual(postFlagged(0.9, POST_FLAG_ON_TOPIC_MAX, 0.01), true);
assert.strictEqual(postFlagged(0.9, 0.9, POST_FLAG_REVEALS_MIN), true);

console.log("guardrail self-check passed");
