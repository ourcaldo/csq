// Assert-based self-check for Baileys destination JID normalization.
// Run:
//   npx tsx scripts/self-check-baileys-jid.ts
// No database needed: toJid is pure.
//
// Why this exists (2026-11-08 incident): the owner typed an Indonesian
// number in local form; the raw append produced "0812...@s.whatsapp.net" -
// a non-existent user WhatsApp accepts silently and never delivers (no echo,
// no error). Sends to a live JID always echo back as a fromMe sync.
import { resolveSendJid, toJid } from "../apps/dashboard/src/services/baileys";

const checks: Array<[string, string, string]> = [
  // [input, expected, name]
  ["081234567890", "6281234567890@s.whatsapp.net", "Indonesian 0-prefix -> 62"],
  ["81234567890", "6281234567890@s.whatsapp.net", "Indonesian no-prefix -> 62"],
  ["+62 812-3456-7890", "6281234567890@s.whatsapp.net", "plus/spaces/dashes stripped"],
  ["6281234567890", "6281234567890@s.whatsapp.net", "already-international unchanged"],
  ["15551234567", "15551234567@s.whatsapp.net", "US number unchanged"],
  ["8613800138000", "8613800138000@s.whatsapp.net", "CN number (8, 13 digits) NOT re-prefixed"],
  ["127642938413286@lid", "127642938413286@lid", "LID JID passes through"],
  ["6281234567890@s.whatsapp.net", "6281234567890@s.whatsapp.net", "PN JID unchanged"],
  ["120363023070965411@g.us", "120363023070965411@g.us", "group JID unchanged"],
];

// LID->PN rewrite at send time (Baileys 6.7.x drops raw LID sends).
const lidChecks: Array<[string, string | null, string, string]> = [
  // [lidJid, pn, expected, name]
  ["127642938413286@lid", "6281234567890", "6281234567890@s.whatsapp.net", "known LID mapping -> phone JID"],
  ["127642938413286@lid", null, "127642938413286@lid", "unknown LID stays raw (last resort)"],
  ["6281234567890@s.whatsapp.net", "6281234567890", "6281234567890@s.whatsapp.net", "phone JID never rewritten"],
];

let failed = 0;
for (const [input, expected, name] of checks) {
  const got = toJid(input);
  if (got === expected) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}: toJid("${input}") = "${got}", expected "${expected}"`);
  }
}
for (const [lidJid, pn, expected, name] of lidChecks) {
  const got = resolveSendJid(lidJid, pn);
  if (got === expected) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}: resolveSendJid("${lidJid}", ${JSON.stringify(pn)}) = "${got}", expected "${expected}"`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length + lidChecks.length} checks passed.`);
