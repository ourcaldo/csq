// Assert-based self-check for the Baileys close handling (2026-11-08 fix).
// Run:
//   npx tsx scripts/self-check-baileys-close.ts
// No database needed: disconnectCode/isFatalDisconnect are pure.
//
// Why this exists: a production incident (2026-11-07, Render logs) showed a
// dead WhatsApp session (code 401) reconnect-churning forever because stale
// creds were never cleared, while the dashboard kept showing "Terhubung".
// The fix classifies close codes into fatal (clear creds, mark DISCONNECTED,
// stop) vs transient (auto-reconnect). This pins the classification AND the
// runtime enum values, so a package update that shifts a code can't silently
// reopen the bug.
import { DisconnectReason } from "@whiskeysockets/baileys";
import { disconnectCode, isFatalDisconnect } from "../src/services/baileys";

// @hapi/boom-shaped error, parsed with Zod at the boundary (no `as` casts).
const boom = (statusCode: number): { output: { statusCode: number } } => ({
  output: { statusCode },
});

const checks: Array<[string, boolean]> = [
  // Runtime enum sanity: the classification below is only correct if these
  // hold at runtime. The .d.ts is types-only - the JS build decides.
  ["DisconnectReason.loggedOut === 401 at runtime", DisconnectReason.loggedOut === 401],
  ["DisconnectReason.connectionReplaced === 440 at runtime", DisconnectReason.connectionReplaced === 440],
  ["DisconnectReason.badSession === 500 at runtime", DisconnectReason.badSession === 500],
  ["DisconnectReason.forbidden === 403 at runtime", DisconnectReason.forbidden === 403],
  ["DisconnectReason.restartRequired === 515 at runtime", DisconnectReason.restartRequired === 515],
  ["DisconnectReason.timedOut === 408 at runtime", DisconnectReason.timedOut === 408],
  // disconnectCode parses the boom shape.
  ["disconnectCode(boom 401) === 401", disconnectCode(boom(401)) === 401],
  ["disconnectCode(non-boom) === undefined", disconnectCode({}) === undefined],
  // Fatal: session is dead server-side - must NOT auto-reconnect.
  ["401 loggedOut is fatal", isFatalDisconnect(disconnectCode(boom(401)))],
  ["440 connectionReplaced is fatal", isFatalDisconnect(disconnectCode(boom(440)))],
  ["500 badSession is fatal", isFatalDisconnect(disconnectCode(boom(500)))],
  ["403 forbidden is fatal", isFatalDisconnect(disconnectCode(boom(403)))],
  // Transient: auto-reconnect keeps the agent on 24/7.
  ["515 restartRequired is transient", !isFatalDisconnect(disconnectCode(boom(515)))],
  ["408 timedOut is transient", !isFatalDisconnect(disconnectCode(boom(408)))],
  ["428 connectionClosed is transient", !isFatalDisconnect(disconnectCode(boom(428)))],
  ["4101 connectionLost is transient", !isFatalDisconnect(disconnectCode(boom(4101)))],
  ["unparseable close is transient (retry, never strand the channel)", !isFatalDisconnect(disconnectCode(new Error("x")))],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed.`);
