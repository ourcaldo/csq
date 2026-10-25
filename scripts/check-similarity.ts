// One-off: measure knowledge.search similarity on the new embedding model so
// KNOWLEDGE_SIMILARITY_THRESHOLD can be sanity-checked against real queries.

import prisma from "../src/lib/db";
import { embed } from "../src/services/embeddings";

async function main() {
  const queries = [
    "kalau barang rusak bisa return?",
    "berapa lama pengirimannya?",
    "bisa grosir?",
  ];
  for (const q of queries) {
    const vec = `[${(await embed(q)).join(",")}]`;
    const rows = await prisma.$queryRaw<{ title: string; similarity: number }[]>`
      SELECT k.title, 1 - (e.embedding <=> ${vec}::vector) AS similarity
      FROM "KnowledgeEmbedding" e
      JOIN "Knowledge" k ON k.id = e."knowledgeId"
      ORDER BY similarity DESC LIMIT 3
    `;
    console.log(`\n"${q}"`);
    for (const r of rows) {
      console.log(`  ${Number(r.similarity).toFixed(3)}  ${r.title}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
