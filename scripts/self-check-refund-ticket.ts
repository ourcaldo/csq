// Assert-based self-check for the FEA-2/FEA-3 (PRD 16) tool definitions:
// order.refund and support.create_ticket. Validates the registry entries,
// default permissions, and the Zod parameter schemas.
// Run: npx tsx scripts/self-check-refund-ticket.ts
// No database needed: only definitions and safeParse are exercised.
import { getTool } from "../packages/core/src/tools/index";

const refund = getTool("order.refund");
const ticket = getTool("support.create_ticket");

const UUID = "123e4567-e89b-42d3-a456-426614174000";

const checks: Array<[string, boolean]> = [
  ["order.refund is registered", refund !== undefined],
  ["order.refund denied by default", refund?.defaultPermission.allowed === false],
  ["order.refund requires approval", refund?.defaultPermission.requiresApproval === true],
  ["order.refund has describeChange for the approval queue", refund?.describeChange !== undefined],
  ["order.refund rejects a missing orderId", refund?.parameters.safeParse({}).success === false],
  ["order.refund rejects a non-uuid orderId", refund?.parameters.safeParse({ orderId: "abc" }).success === false],
  ["order.refund accepts orderId only (amount defaults to the order total)", refund?.parameters.safeParse({ orderId: UUID }).success === true],
  ["order.refund accepts a positive amount + reason", refund?.parameters.safeParse({ orderId: UUID, amount: 5000, reason: "barang rusak" }).success === true],
  ["order.refund rejects a zero amount", refund?.parameters.safeParse({ orderId: UUID, amount: 0 }).success === false],
  ["order.refund rejects a negative amount", refund?.parameters.safeParse({ orderId: UUID, amount: -1 }).success === false],
  ["support.create_ticket is registered", ticket !== undefined],
  ["support.create_ticket allowed by default", ticket?.defaultPermission.allowed === true],
  ["support.create_ticket needs no approval", ticket?.defaultPermission.requiresApproval === false],
  ["support.create_ticket accepts subject + body", ticket?.parameters.safeParse({ subject: "Refund belum diproses", body: "Pelanggan menunggu kabar sejak Senin." }).success === true],
  ["support.create_ticket rejects an empty subject", ticket?.parameters.safeParse({ subject: "", body: "isi" }).success === false],
  ["support.create_ticket rejects a 121-char subject", ticket?.parameters.safeParse({ subject: "x".repeat(121), body: "isi" }).success === false],
  ["support.create_ticket rejects a 2001-char body", ticket?.parameters.safeParse({ subject: "subjek", body: "x".repeat(2001) }).success === false],
  ["support.create_ticket rejects a missing body", ticket?.parameters.safeParse({ subject: "subjek" }).success === false],
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
console.log("all refund/ticket checks passed");
