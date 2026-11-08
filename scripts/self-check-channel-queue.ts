// Assert-based self-check for the Phase 6 cross-process queue contracts
// (PRD 23C). The ChannelCommand.result JSON is written by the worker
// (services/channel-runtime.ts) and read by the dashboard routes
// (lib/channel-commands.ts + channels/[id]/qr.ts) - both sides parse through
// the same Zod schema, and this pins it. Run:
//   npx tsx scripts/self-check-channel-queue.ts
import { channelCommandResultSchema } from "../packages/core/src/types/channel-queue";

const checks: Array<[string, boolean]> = [
  [
    "full connect result parses",
    channelCommandResultSchema.safeParse({
      qr: "2@abc123,xyz==,",
      open: true,
      closeCode: 401,
    }).success,
  ],
  [
    "pending-pairing result parses (nulls)",
    channelCommandResultSchema.safeParse({
      qr: null,
      open: false,
      closeCode: null,
    }).success,
  ],
  ["empty result parses", channelCommandResultSchema.safeParse({}).success],
  [
    "non-string qr rejected",
    !channelCommandResultSchema.safeParse({ qr: 123 }).success,
  ],
  [
    "string closeCode rejected",
    !channelCommandResultSchema.safeParse({ closeCode: "401" }).success,
  ],
  [
    "non-boolean open rejected",
    !channelCommandResultSchema.safeParse({ open: "yes" }).success,
  ],
];

for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}`);
  if (!ok) process.exit(1);
}
console.log(`all ${checks.length} channel-queue checks passed`);
