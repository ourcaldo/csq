import { execSync } from "child_process";

// Boot-time `prisma migrate deploy` wrapper (PRD 16 SEC-1). Migrations must
// run as the table OWNER: the app role (csq_app) is subject to RLS and has
// no DDL rights. When DATABASE_URL points at csq_app, this script runs the
// migration with DATABASE_URL_UNPOOLED (the owner role) instead - both env
// vars are passed to the CLI because schema.prisma declares both.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("migrate-deploy: DATABASE_URL (or DATABASE_URL_UNPOOLED) is not set");
  process.exit(1);
}

execSync("prisma migrate deploy --schema prisma/schema.prisma", {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: url,
    DATABASE_URL_UNPOOLED: url,
  },
});
