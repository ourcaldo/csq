import prisma from "@csq/core/lib/db";
import {
  withTenantContext,
  withSystemContext,
} from "@csq/core/lib/tenant-context";

// RLS self-check (PRD 16 SEC-1). Proves the acceptance: with the app role,
// a query under tenant A's context returns zero rows for tenant B, no
// context returns zero rows on tenant tables, and the bypass context sees
// across tenants. Run against the clone stack with DATABASE_URL pointing at
// the csq_app role:
//   DATABASE_URL=... npm run check:rls
// Exits non-zero on any violation. Scratch tenants are created and removed
// so the check is safe to re-run.

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`[rls] ok - ${label}`);
  } else {
    failures += 1;
    console.error(`[rls] FAIL - ${label}${detail ? `: ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[rls] DATABASE_URL is required (the csq_app connection string)");
    process.exit(1);
  }

  const who: Array<{ current_user: string }> = await prisma.$queryRaw<
    Array<{ current_user: string }>
  >`SELECT current_user`;
  if (who[0]?.current_user === "neondb_owner") {
    console.error(
      "[rls] DATABASE_URL is the table owner; the owner bypasses RLS. Point it at the csq_app role."
    );
    process.exit(1);
  }

  const stamp = `rls-probe-${Date.now()}`;
  await withSystemContext(async () => {
    await prisma.tenant.createMany({
      data: [
        { name: `${stamp}-a`, slug: `${stamp}-a` },
        { name: `${stamp}-b`, slug: `${stamp}-b` },
      ],
    });
  });
  const tenants = await withSystemContext(async () =>
    prisma.tenant.findMany({ where: { slug: { startsWith: stamp } } })
  );
  const a = tenants.find((t) => t.slug === `${stamp}-a`);
  const b = tenants.find((t) => t.slug === `${stamp}-b`);
  if (!a || !b) throw new Error("[rls] scratch tenants were not created");

  try {
    await withTenantContext(a.id, async () => {
      await prisma.product.create({
        data: { tenantId: a.id, name: stamp, price: 1 },
      });
      await prisma.product.create({
        data: { tenantId: b.id, name: stamp, price: 1 },
      }).then(
        () => check("cross-tenant insert blocked", false, "insert under A for B succeeded"),
        () => check("cross-tenant insert blocked", true)
      );
    });

    await withTenantContext(b.id, async () => {
      await prisma.product.create({
        data: { tenantId: b.id, name: stamp, price: 1 },
      });
    });

    await withTenantContext(a.id, async () => {
      const rows = await prisma.product.findMany({ where: { name: stamp } });
      check(
        "context A sees only tenant A rows",
        rows.length === 1 && rows[0].tenantId === a.id
      );
    });

    await withTenantContext(b.id, async () => {
      const rows = await prisma.product.findMany({ where: { name: stamp } });
      check(
        "context B sees zero rows of A",
        rows.every((r) => r.tenantId === b.id)
      );
    });

    const noContext = await prisma.product.findMany({ where: { name: stamp } });
    check("no context fails closed (zero rows)", noContext.length === 0);

    const viaBypass = await withSystemContext(async () =>
      prisma.product.findMany({ where: { name: stamp } })
    );
    check("bypass sees both tenants", viaBypass.length === 2);
  } finally {
    await withSystemContext(async () => {
      await prisma.tenant.deleteMany({ where: { slug: { startsWith: stamp } } });
    });
  }

  if (failures > 0) {
    console.error(`[rls] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("[rls] all checks passed");
}

main()
  .catch((err: unknown) => {
    console.error("[rls] check crashed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
