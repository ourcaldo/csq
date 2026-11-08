-- D8: knowledge semantic retrieval is a sequential scan today — no vector
-- index exists on KnowledgeEmbedding.embedding, so every knowledge.search
-- orders by cosine distance over the whole tenant's rows. HNSW with the
-- cosine operator class matches the `<=>` ordering in src/lib/vector.ts.
-- Post-filtered by tenantId at query time; at large tenant sizes a filtered
-- HNSW search can return fewer than LIMIT rows — the tuning knob is
-- SET hnsw.ef_search (noted in vector.ts).
CREATE INDEX "KnowledgeEmbedding_embedding_hnsw_idx"
ON "KnowledgeEmbedding" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
