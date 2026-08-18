import prisma from "../src/lib/db";
import { seedDemo } from "./seed";

// Reset the demo tenant (Toko Kopi Nusantara) to a clean, known-good state.
// Deleting the tenant cascades to every tenant-owned row (User, Agent,
// Channel, Product, Inventory, Order, OrderItem, Knowledge, Memory,
// DataSource, AgentCapability, AuditLog, Approval, Conversation, Contact,
// Message, Tag, ConversationTag) per the schema's onDelete: Cascade, then
// seedDemo() recreates everything fresh. Run with `npm run demo:reset`.

async function main() {
  const slug = "toko-kopi-nusantara";
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    await prisma.tenant.delete({ where: { id: existing.id } });
    console.log(`Deleted existing demo tenant: ${slug}`);
  }
  await seedDemo();
  console.log("Demo reset complete.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
