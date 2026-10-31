// Print the Prisma migration checksum for every migration folder:
// sha256 of migration.sql with CRLF normalized to LF.
//
// Why this exists: production migrations are applied to Neon over the MCP
// run_sql tool (no local DATABASE_URL, no secrets in the shell), which does
// not write the _prisma_migrations bookkeeping. After applying a migration's
// SQL manually, insert the bookkeeping row with this checksum so
// `prisma migrate deploy` (Dockerfile boot) sees it as applied and skips it:
//
//   INSERT INTO "_prisma_migrations"
//     (id, checksum, finished_at, migration_name, logs, rolled_back_at,
//      started_at, applied_steps_count)
//   VALUES (gen_random_uuid()::text, '<checksum>', NOW(), '<folder>', NULL,
//           NULL, NOW(), 1);
//
// Algorithm verified 2026-11-01 against the live _prisma_migrations table:
// 16/16 unmodified applied migrations match exactly. (Three older migrations
// were edited after they were applied, so their stored checksums no longer
// match the files - harmless for `migrate deploy`, which does not verify.)
import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";

const dir = "prisma/migrations/";
for (const name of readdirSync(dir).sort()) {
  if (!statSync(dir + name).isDirectory()) continue;
  const content = readFileSync(dir + name + "/migration.sql", "utf8");
  const checksum = createHash("sha256")
    .update(content.replace(/\r\n/g, "\n"))
    .digest("hex");
  console.log(name, checksum);
}
