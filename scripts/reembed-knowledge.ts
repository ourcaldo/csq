// One-off backfill: re-embed all knowledge rows with the current embedding
// provider (Cloudflare Workers AI / @cf/baai/bge-m3 after the Fireworks
// migration). Old Fireworks vectors live in a different vector space —
// semantic search returns garbage until every row is re-embedded.
//
// Run from the repo root (uses the project's .env):
//   npx tsx scripts/reembed-knowledge.ts
//
// Safe to re-run: idempotent upsert per knowledge row.

import prisma from "../src/lib/db";
import { embed } from "../src/services/embeddings";

async function main() {
  const rows = await prisma.knowledge.findMany({
    select: { id: true, tenantId: true, type: true, title: true, content: true },
  });
  console.log(`re-embedding ${rows.length} knowledge row(s)...`);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const text = `${row.type}: ${row.title}\n${row.content}`;
    try {
      const vector = await embed(text);
      const serialized = `[${vector.join(",")}]`;
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeEmbedding" (id, "knowledgeId", "tenantId", embedding, "createdAt")
        VALUES (gen_random_uuid()::text, ${row.id}, ${row.tenantId}, ${serialized}::vector, NOW())
        ON CONFLICT ("knowledgeId") DO UPDATE
        SET embedding = EXCLUDED.embedding
      `;
      ok++;
      console.log(`  ok: ${row.title}`);
    } catch (err) {
      failed++;
      console.warn(`  FAILED: ${row.title} — ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`done: ${ok} re-embedded, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
