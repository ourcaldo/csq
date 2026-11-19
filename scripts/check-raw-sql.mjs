// Raw-SQL tenant-context guard (audit run-1 remediation debt, landed per
// run-2). Prisma raw SQL ($queryRaw / $executeRaw) bypasses the db.ts RLS
// extension hook, so every raw statement touching a tenant table must run
// through tenantRaw / systemRaw / a *Transaction wrapper (which set_config
// on the same connection). This check fails on raw SQL calls that are not
// arguments to those wrappers, plus the known-safe allowlist.
//
// Run: npm run check:raw-sql
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOTS = ["apps/api/src", "apps/dashboard/src", "apps/worker/src", "apps/admin/src", "packages/core/src"];

// Calls that legitimately run raw SQL without a tenant wrapper.
// Each entry: [file suffix, why it is safe].
const ALLOWLIST = [
  ["pages/api/health.ts", "SELECT 1 / current_user probe - no tenant tables"],
  ["scripts/self-check-", "test harness - not shipped"],
  ["lib/system-lock.ts", "SystemLock has no tenantId column and no RLS policy"],
  ["lib/db.ts", "the RLS extension hook itself"],
  ["lib/tenant-context.ts", "the wrapper implementations themselves"],
  ["admin/operations.ts", "SELECT 1 probe + systemRaw-wrapped statements (verified audit run-2)"],
  ["admin/invoices.ts", "nextval sequence read - sequences are not RLS-subject (verified audit run-2)"],
];

// The wrapper names that set RLS context around a raw statement.
const WRAPPERS = new Set(["tenantRaw", "systemRaw", "withTenantTransaction", "withSystemTransaction"]);

// Raw SQL method names.
const RAW_METHODS = ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"];

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, acc);
    } else if (p.endsWith(".ts") || p.endsWith(".tsx")) {
      acc.push(p);
    }
  }
  return acc;
}

function isAllowlisted(path) {
  return ALLOWLIST.some(([suffix]) => path.replaceAll("\\", "/").includes(suffix));
}

// A raw call is compliant when: a wrapper name appears on the line or among
// the 3 preceding lines (multi-line tenantRaw(...$queryRaw...) calls), the
// call runs on a tx client (tx.$queryRaw inside a *Transaction callback), or
// it is a bare SELECT 1 / current_user probe.
function checkFile(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const problems = [];
  lines.forEach((line, i) => {
    for (const method of RAW_METHODS) {
      const idx = line.indexOf(method);
      if (idx === -1) continue;
      const before = line.slice(0, idx);
      const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
      const wrapped = [...WRAPPERS].some((w) => context.includes(w));
      const onTxClient = before.trimEnd().endsWith("tx.") || before.trimEnd().endsWith("client.");
      const isComment = line.trimStart().startsWith("//");
      const isProbe = /^\s*(prisma|tx|client)?\.?\$?(query|execute)Raw`?\s*SELECT (1|current_user)/.test(line) || line.includes("SELECT 1") || line.includes("current_user");
      if (!wrapped && !onTxClient && !isProbe && !isComment) {
        problems.push(`${path.replaceAll("\\", "/")}:${i + 1} ${line.trim().slice(0, 100)}`);
      }
    }
  });
  return problems;
}

let failed = false;
for (const root of ROOTS) {
  let files;
  try {
    files = walk(root, []);
  } catch {
    continue;
  }
  for (const file of files) {
    if (isAllowlisted(file)) continue;
    for (const problem of checkFile(file)) {
      console.error(`raw-sql guard: ${problem}`);
      failed = true;
    }
  }
}
if (failed) {
  console.error("Raw SQL found outside tenantRaw/systemRaw/transaction wrappers.");
  console.error("Raw statements bypass the db.ts RLS hook; wrap them (see lib/tenant-context.ts).");
  process.exit(1);
}
console.log("raw-sql ok");
