# PRD 31 - Pengetahuan: Kategori and Multi-Q&A FAQ Entries

Status: LIVE - approved by the owner on 2026-11-25 ("Please implement
it"); the section 8 decisions were taken as the proposed defaults:
six categories, 20-pair cap, no separate category filter in v1.
Implemented and live-verified the same day (commit 5bee0ff).

Related: PRD 03 section 15.4 (knowledge owner actions), PRD 16 FEA-1
(document upload), PRD 06 section 23A (pgvector retrieval),
`docs/prd/12-shared-ui-package.md` (UI conventions).

## 1. Problem

The Pengetahuan model today is one `Knowledge` row = one question-answer
pair for FAQ. The owner maintains FAQ as scattered single entries:

- Related questions about the same topic (three questions about
  shipping, for example) require three separate entries with no visible
  grouping.
- There is no category dimension, so the list cannot be organized or
  filtered by topic ( Produk, Pengiriman, Pembayaran...).

The owner's request (2026-11-25):

1. A Kategori field in the composer.
2. FAQ entries can hold multiple Q&A pairs in one composer, with an
   add-pair button - not one entry per single Q&A.

## 2. Goals

1. A `Kategori` on every knowledge entry, from a fixed vocabulary,
   visible and filterable in the list.
2. FAQ entries holding N question-answer pairs, edited as ONE entry in
   the UI.
3. Retrieval quality per pair: `knowledge.search` must match the
   specific PAIR a question is about, not the average of a whole set.
4. The list page follows the approved design template: stat strip,
   search, jenis chips, sort, category column, full-page composer
   (owner UI rules 2026-11-23: no modals, no inline reveals).

## 3. Non-goals

- Free-form or hierarchical (nested) categories. Fixed vocabulary only.
- Per-category permissions or visibility. Category is organization, not
  access control.
- Categorizing individual document chunks (FEA-1 uploads). Uploaded
  documents get one category on the entry.
- Bulk re-embedding of existing rows (see 7.3).
- Changes to `knowledge.search` tool contract, thresholds, or the HNSW
  index. This PRD must NOT degrade retrieval.

## 4. Data model

### 4.1 Category

`Knowledge.category String?`

- Stored as a plain string. Display value is Indonesian; the value set
  is fixed in application code (seeded vocabulary, not a DB table):
  `Umum`, `Produk`, `Pengiriman`, `Pembayaran`, `Kebijakan`,
  `Layanan`.
- NULL displays and filters as `Umum`. Backfill NOT required: existing
  rows stay NULL and behave as Umum.
- Validated at the API boundary with Zod (enum of the six values or
  NULL). No free text.

### 4.2 FAQ pairs (the core decision)

A multi-pair FAQ entry is modeled as N `Knowledge` rows sharing a
`groupId`, NOT as a JSON column or a child table:

```
Knowledge.groupId String?        // uuid; FAQ entries share one id per entry
Knowledge.title                 // = the pair's question (FAQ)
Knowledge.content               // = the pair's answer (FAQ)
```

Why rows-per-pair instead of a child table or JSON array:

1. Embeddings stay 1:1 with `Knowledge` rows (the UNIQUE constraint on
   `KnowledgeEmbedding.knowledgeId` holds). Each pair gets its own
   vector built from its own question + answer, so a customer question
   matches the specific pair. Concatenating N pairs into one vector (the
   JSON/child-table shape would force this without further schema
   changes) averages the topics and visibly degrades retrieval - that
   is the defect this choice exists to avoid.
2. `knowledge.search`, `lib/vector.ts`, the HNSW index, RLS policies,
   the keyword fallback, and the audit trail all keep working without
   changes.
3. POLICY and BUSINESS_INFO keep their current single-row shape
   (groupId NULL). Documents (FEA-1) unchanged.

Trade-off to accept consciously: "one entry" is N physical rows, so
list, update, and delete operate on groups. That complexity lives in the
API layer once, not in the retrieval layer.

- `groupId` is generated server-side on create; the client never
  supplies it.
- An FAQ entry always has at least 1 pair and at most 20 pairs
  (validation bound; matches composer UI limits).
- The group shares one `type`, one `category`, and one `updatedAt`
  (the API stamps all rows on any edit).

### 4.3 Migration

One additive migration:

- `ALTER TABLE "Knowledge" ADD COLUMN "category" TEXT NULL;`
- `ALTER TABLE "Knowledge" ADD COLUMN "groupId" TEXT NULL;`
- `CREATE INDEX "Knowledge_tenantId_groupId_idx" ON "Knowledge"("tenantId", "groupId");`
- Backfill: existing FAQ rows get `groupId = id` (a group of one).
  POLICY / BUSINESS_INFO rows stay NULL.

RLS: `Knowledge` policies already cover the table; new columns need no
policy change.

## 5. Retrieval semantics (unchanged by design)

- Embedding input for FAQ pairs stays `title\ncontent` (question +
  answer of THAT pair). Category is appended to the embedding input and
  keyword fallback text (`title\ncontent\ncategory`) - a small positive
  for topical matching; not required for correctness.
- `knowledge.search` returns rows (= pairs). For FAQ the tool's result
  formatting gains the pair context (question) - already the `title`.
  No tool contract change; agents see the same shape.
- Prompt loading is untouched: FAQ and POLICY are never in the system
  prompt; retrieval stays on demand (AGENTS rule 10).

## 6. Dashboard

### 6.1 List page (adopts the approved template)

- Stat strip: total entri, FAQ, Kebijakan, Info Usaha (computed from the
  list API response; no separate counts endpoint).
- Search across question/answer/content and category; jenis chips
  (Semua / FAQ / Kebijakan / Info Usaha); sort (terbaru, judul, jenis).
- Columns: Judul (FAQ shows the first question + pair-count preview),
  Jenis, Kategori, Sumber (badge for document uploads, "Manual"
  otherwise), Diperbarui, Aksi.
- FAQ rows render as ONE row per group. Page size counts groups, not
  raw rows.

### 6.2 Composer (full page, no modal)

- Jenis picker (FAQ / Kebijakan / Info Usaha).
- Kategori select (vocabulary above, default Umum).
- FAQ mode: repeatable Q&A blocks - question input + answer textarea per
  block, numbered, remove button per block, "Tambah Q&A" button,
  minimum one complete pair. Save validates: every block has both
  question and answer; 1 to 20 pairs.
- Kebijakan / Info Usaha mode: single Judul + Isi (current behavior).
- Unggah Dokumen: separate full-page view (drop zone, optional judul);
  category fixed to `Umum` at upload, editable afterwards by editing the
  entry.
- Edit: same composer pre-filled; editing an FAQ group diffs pairs
  row-wise (create new rows for added pairs, delete rows for removed
  pairs, update changed rows in place - embeddings re-upserted only for
  rows whose text changed).

### 6.3 Delete

- Deleting an FAQ entry deletes the whole group (one confirm dialog is
  acceptable for destructive confirmation; entity EDITING is what must
  not be a modal).

## 7. API

### 7.1 Shapes

- `POST /api/dashboard/knowledge/create`
  - non-FAQ: `{ type, title, content, category? }` (today's shape +
    category)
  - FAQ: `{ type: "FAQ", category?, pairs: [{ q, a }, ...] }`
- `PUT /api/dashboard/knowledge/:id` - id is any row of the group (or
  the group's first row id; the API resolves `groupId`). Same body
  shapes; FAQ replaces the pair set.
- `GET /api/dashboard/knowledge` - grouped list response:
  `{ items: [{ id (group id), type, category, title, preview, pairCount,
  pairs: [{id, q, a}], source, updatedAt }], page, pageSize, total }`.
  Grouping happens server-side; the UI must not stitch rows.
- `DELETE /api/dashboard/knowledge/:id` - deletes the group.

All routes keep the `pengetahuan.kelola` gate and the audit log
(`knowledge.create` / `knowledge.update` / `knowledge.delete`, before
and after values on the group).

### 7.2 Compatibility

- Existing rows (groupId backfilled to own id) already satisfy the group
  invariants, so no data migration beyond 4.3 is needed.
- The old single-pair create shape keeps working (a FAQ create without
  `pairs` is accepted as one pair built from `title` + `content`), so
  any existing client or seed keeps functioning during rollout.

### 7.3 Embeddings on edit

Rows whose text changed get re-embedded on save (existing behavior per
row). No background re-embedding job: rows only gain category text in
their embedding when they are next edited. Accepted gap, not worth a
sweep.

## 8. Open decisions (owner)

1. Vocabulary: is the six-category list above right, or add/remove any?
   (Fixed list; editable later in code, not by tenants.)
2. Pair cap: 20 pairs per FAQ entry OK as the validation bound?
3. Should the list also get a Kategori filter (chips or select), or is
   the Kategori column + search enough for v1?

## 9. Verification plan

1. Migration: applied to the clone; `npm run db:generate` clean;
   existing rows keep their embeddings and are retrievable.
2. Retrieval parity: with embeddings configured, create a 3-pair FAQ
   about shipping; ask the agent a question matching pair 2 - verify
   `knowledge.search` returns pair 2's row with a similarity at least
   as good as the single-entry baseline.
3. API: create/edit/delete an FAQ group via curl or the UI; verify one
   audit row per action and row-wise embedding upserts in the DB.
4. UI: full-page composer per the template (no modals), category
   column, pair-count preview, search and jenis chips, delete group
   with one confirmation.
5. Degradation: with embeddings unconfigured, keyword fallback still
   finds pairs by question text.

## 10. Approval

Implementation may start once the owner resolves section 8. The design
template referenced in section 6 is already owner-approved
("the template is quite good already", 2026-11-25).
