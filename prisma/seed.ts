import prisma from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

// Demo tenant: Toko Kopi Nusantara (PRD §21). Run with `npm run prisma:seed`.
// Idempotent-ish: upserts by unique keys (tenant slug, user email, inventory
// productId) and findFirst-or-create for products/knowledge (no unique on
// (tenantId, sku) by design — only an index).

// Seed the demo tenant, owner, products, knowledge, agent + capabilities, and
// a WhatsApp channel. Exported so prisma/reset-demo.ts can reuse it after
// wiping the demo tenant.
export async function seedDemo(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "toko-kopi-nusantara" },
    update: {},
    create: {
      name: "Toko Kopi Nusantara",
      slug: "toko-kopi-nusantara",
      settings: { sourcePriority: ["MANUAL", "GOOGLE_SHEETS", "EXCEL"] },
    },
  });

  const passwordHash = await hashPassword("demo1234");
  await prisma.user.upsert({
    where: { email: "admin@tokokopi.id" },
    update: {},
    create: {
      email: "admin@tokokopi.id",
      name: "Owner Toko Kopi",
      passwordHash,
      role: "OWNER",
      tenantId: tenant.id,
    },
  });

  const products = [
    { name: "Kopi Arabica 250g", sku: "ARAB-250", price: 85000, stock: 12 },
    { name: "Kopi Robusta 250g", sku: "ROB-250", price: 65000, stock: 8 },
    { name: "Kopi Liberica 200g", sku: "LIB-200", price: 75000, stock: 5 },
  ];

  for (const p of products) {
    const product =
      (await prisma.product.findFirst({
        where: { tenantId: tenant.id, sku: p.sku },
      })) ??
      (await prisma.product.create({
        data: { tenantId: tenant.id, name: p.name, sku: p.sku, price: p.price },
      }));

    await prisma.inventory.upsert({
      where: { productId: product.id },
      update: { quantity: p.stock, source: "MANUAL" },
      create: {
        tenantId: tenant.id,
        productId: product.id,
        quantity: p.stock,
        source: "MANUAL",
      },
    });
  }

  const faqs = [
    {
      title: "Apakah bisa pesan dalam jumlah grosir?",
      content:
        "Ya, Kak. Kami menerima pesanan grosir dengan minimal 10 pcs. Silakan hubungi kami untuk harga khusus.",
    },
    {
      title: "Berapa lama pengiriman?",
      content:
        "Pengiriman within Jabodetabek 1-2 hari kerja, luar Jabodetabek 3-5 hari kerja.",
    },
  ];

  for (const f of faqs) {
    await ensureKnowledge(tenant.id, "FAQ", f.title, f.content);
  }

  await ensureKnowledge(
    tenant.id,
    "POLICY",
    "Kebijakan Pengiriman",
    "Pesanan diproses pada hari kerja sebelum pukul 15.00 WIB. Pengiriman menggunakan ekspedisi pilihan pelanggan. Biaya pengiriman ditanggung pelanggan kecuali ada promo gratis ongkir."
  );
  await ensureKnowledge(
    tenant.id,
    "POLICY",
    "Kebijakan Retur",
    "Barang dapat ditukar jika rusak atau cacat produksi dalam 3 hari setelah diterima, dengan melampirkan foto dan bukti pembelian. Pengembalian dana dilakukan setelah verifikasi."
  );

  // ── Demo Customer Service Agent + capabilities + WhatsApp channel ──
  const agent =
    (await prisma.agent.findFirst({
      where: { tenantId: tenant.id, name: "Kopi Nusantara CS" },
    })) ??
    (await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Kopi Nusantara CS",
        type: "CUSTOMER_SERVICE",
        status: "DRAFT",
        instructions:
          "Kamu adalah customer service Toko Kopi Nusantara. Jawab dengan ramah dalam Bahasa Indonesia. " +
          "Bantu pelanggan mencari produk, cek stok, dan membuat pesanan. JANGAN pernah mengubah harga " +
          "tanpa persetujuan owner — perubahan harga selalu butuh approval.",
      },
    }));

  // Explicit capabilities (deterministic for the demo). Matches tool defaults:
  // reads allowed/no-approval; writes denied/approval (owner must enable).
  const capabilities: Array<{ tool: string; allowed: boolean; requiresApproval: boolean }> = [
    { tool: "product.read", allowed: true, requiresApproval: false },
    { tool: "product.search", allowed: true, requiresApproval: false },
    { tool: "product.update", allowed: false, requiresApproval: true },
    { tool: "inventory.read", allowed: true, requiresApproval: false },
    { tool: "inventory.update", allowed: false, requiresApproval: true },
    { tool: "order.read", allowed: true, requiresApproval: false },
    { tool: "order.create", allowed: false, requiresApproval: true },
    { tool: "order.cancel", allowed: false, requiresApproval: true },
    { tool: "customer.read", allowed: true, requiresApproval: false },
    { tool: "customer.update", allowed: false, requiresApproval: true },
    { tool: "knowledge.search", allowed: true, requiresApproval: false },
  ];
  for (const cap of capabilities) {
    await prisma.agentCapability.upsert({
      where: { agentId_tool: { agentId: agent.id, tool: cap.tool } },
      update: { allowed: cap.allowed, requiresApproval: cap.requiresApproval },
      create: {
        tenantId: tenant.id,
        agentId: agent.id,
        tool: cap.tool,
        allowed: cap.allowed,
        requiresApproval: cap.requiresApproval,
      },
    });
  }

  // WhatsApp Cloud API channel (DISCONNECTED — owner fills real creds to demo).
  const existingChannel = await prisma.channel.findFirst({
    where: { tenantId: tenant.id, provider: "CLOUD_API" },
  });
  if (!existingChannel) {
    await prisma.channel.create({
      data: {
        tenantId: tenant.id,
        agentId: agent.id,
        type: "WHATSAPP",
        provider: "CLOUD_API",
        status: "DISCONNECTED",
        config: {
          phoneNumberId: "DEMO_PHONE_NUMBER_ID",
          token: "DEMO_TOKEN",
          verifyToken: "demo-verify-token",
          businessAccountId: "DEMO_BUSINESS_ACCOUNT_ID",
        },
      },
    });
  }

  console.log("Seeded demo tenant:", tenant.slug);
}

async function ensureKnowledge(
  tenantId: string,
  type: "FAQ" | "POLICY" | "BUSINESS_INFO",
  title: string,
  content: string
): Promise<void> {
  const existing = await prisma.knowledge.findFirst({
    where: { tenantId, type, title },
  });
  if (existing) {
    await prisma.knowledge.update({ where: { id: existing.id }, data: { content } });
    return;
  }
  await prisma.knowledge.create({ data: { tenantId, type, title, content } });
}

async function main() {
  await seedDemo();
}

// Run only when executed directly (not when imported by reset-demo.ts).
if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
