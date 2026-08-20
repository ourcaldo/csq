import prisma from "@/lib/db";

// ALL pgvector reads and writes go through this module. No raw vector SQL
// anywhere else. Prisma declares the embedding column as Unsupported("vector");
// the actual Postgres type is vector(1024) (Fireworks fireworks/qwen3-embedding-8b
// via the `dimensions` param), altered in a migration. Embeddings are generated
// in src/services/embeddings.ts. Cosine distance operator is `<=>`; similarity
// = 1 - distance. Qwen3 vectors are not unit-length, but `<=>` is magnitude-
// invariant so no normalization is required.

type VectorModel = "KnowledgeEmbedding";

type FindSimilarRow = {
  id: string;
  knowledgeId: string;
  similarity: number;
};

type FindSimilarOptions = {
  threshold?: number;
  limit?: number;
  // Reserved for future agent-scope filters; not yet applied (single vector model).
  filters?: Record<string, unknown>;
};

function assertModel(model: VectorModel): void {
  if (model !== "KnowledgeEmbedding") {
    throw new Error(`Unsupported vector model: ${model}`);
  }
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function upsertEmbedding(
  model: VectorModel,
  recordId: string,
  tenantId: string,
  embedding: number[]
): Promise<void> {
  assertModel(model);
  const vector = toVectorLiteral(embedding);
  // `id` is TEXT NOT NULL with no DB default (Prisma's @default(uuid()) is
  // client-side only, and this is raw SQL), so generate it here with
  // gen_random_uuid()::text. ON CONFLICT on the unique "knowledgeId" makes the
  // create-vs-update distinction automatic.
  await prisma.$executeRaw`
    INSERT INTO "KnowledgeEmbedding" (id, "knowledgeId", "tenantId", embedding, "createdAt")
    VALUES (gen_random_uuid()::text, ${recordId}, ${tenantId}, ${vector}::vector, NOW())
    ON CONFLICT ("knowledgeId") DO UPDATE
    SET embedding = ${vector}::vector, "tenantId" = ${tenantId}
  `;
}

export async function findSimilar(
  model: VectorModel,
  tenantId: string,
  queryEmbedding: number[],
  options?: FindSimilarOptions
): Promise<FindSimilarRow[]> {
  assertModel(model);
  const threshold = options?.threshold ?? 0.7;
  const limit = options?.limit ?? 5;
  const vector = toVectorLiteral(queryEmbedding);
  return prisma.$queryRaw<FindSimilarRow[]>`
    SELECT id, "knowledgeId", 1 - (embedding <=> ${vector}::vector) AS similarity
    FROM "KnowledgeEmbedding"
    WHERE "tenantId" = ${tenantId}
      AND 1 - (embedding <=> ${vector}::vector) >= ${threshold}
    ORDER BY embedding <=> ${vector}::vector
    LIMIT ${limit}
  `;
}

export async function deleteEmbedding(
  model: VectorModel,
  recordId: string,
  tenantId: string
): Promise<void> {
  assertModel(model);
  await prisma.$executeRaw`
    DELETE FROM "KnowledgeEmbedding"
    WHERE "knowledgeId" = ${recordId} AND "tenantId" = ${tenantId}
  `;
}
