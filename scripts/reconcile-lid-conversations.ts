// One-time LID reconciliation (2026-11-22 incident): for every LidMapping
// row, fold any "<lid>@lid"-keyed conversation into the digits one using the
// SAME production code path (reconcileLidConversation), so a replay can
// never diverge from live reconciliation. Safe to run repeatedly: every step
// is idempotent and no-ops when the LID thread is gone.
//
// Run against the clone branch:
//   DATABASE_URL=<clone> npx tsx scripts/reconcile-lid-conversations.ts
import prisma from "@csq/core/lib/db";
import { reconcileLidConversation } from "@csq/core/lib/inbox";

async function main() {
  const mappings = await prisma.lidMapping.findMany();
  const seen = new Set<string>();
  let merged = 0;
  let renamed = 0;
  for (const m of mappings) {
    const key = `${m.channelId}:${m.lid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const channel = await prisma.channel.findUnique({ where: { id: m.channelId } });
    if (!channel) continue;
    const before = await prisma.conversation.count({
      where: { tenantId: channel.tenantId, customerPhone: `${m.lid}@lid` },
    });
    if (!before) continue;
    const digitsConv = await prisma.conversation.findUnique({
      where: {
        tenantId_customerPhone: {
          tenantId: channel.tenantId,
          customerPhone: m.pn,
        },
      },
    });
    await reconcileLidConversation({
      tenantId: channel.tenantId,
      channelId: m.channelId,
      lidUser: m.lid,
      pnUser: m.pn,
    });
    if (digitsConv) merged += 1;
    else renamed += 1;
    console.log(`${digitsConv ? "merged" : "renamed"} ${m.lid}@lid -> ${m.pn}`);
  }
  const left = await prisma.conversation.findMany({
    where: { customerPhone: { endsWith: "@lid" } },
    select: { customerPhone: true },
  });
  console.log(`\ndone: ${merged} merged, ${renamed} renamed.`);
  console.log(
    left.length > 0
      ? `unmapped LID threads left (no mapping learned yet): ${left.map((c) => c.customerPhone).join(", ")}`
      : "no LID-keyed conversations remain."
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
