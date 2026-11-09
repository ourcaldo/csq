import { Prisma } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import {
  getTenantEntitlements,
  getTenantUsage,
  monthStartUtc,
} from "@csq/core/lib/entitlements";
import { chargeCredits, getCreditStatus } from "@csq/core/lib/credits";
import { createTenantWithOwner } from "@csq/core/lib/provision-tenant";

// Billing + quota self-check (PRD 16 BIL-4; also proves COR-5, COR-7 and
// ADM-8). Assert-based, exits non-zero on any failure. Scratch rows are
// created and removed, so it is safe to re-run:
//   DATABASE_URL=<app role> npm run check:billing

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`[billing] ok - ${label}`);
  } else {
    failures += 1;
    console.error(`[billing] FAIL - ${label}${detail ? `: ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[billing] DATABASE_URL is required");
    process.exit(1);
  }
  const who: Array<{ current_user: string }> = await prisma.$queryRaw<
    Array<{ current_user: string }>
  >`SELECT current_user`;
  if (who[0]?.current_user === "neondb_owner") {
    console.error(
      "[billing] DATABASE_URL is the table owner; run with the app role for a meaningful check"
    );
    process.exit(1);
  }

  await withSystemContext(async () => {
    // COR-7: the Basic catalog row is reproducible.
    const basic = await prisma.plan.findUnique({ where: { name: "Basic" } });
    check(
      "Basic plan seeded",
      !!basic &&
        basic.priceIdr === 500000 &&
        basic.aiCreditsPerMonth === 15000 &&
        basic.staffLimit === 1 &&
        basic.channelLimit === 1,
      basic ? `price ${basic.priceIdr}, credits ${basic.aiCreditsPerMonth}` : "missing"
    );

    // ADM-8: shared provisioning produces the documented defaults.
    const stamp = `billing-check-${Date.now()}`;
    const { tenantId, userId } = await createTenantWithOwner({
      name: `${stamp}`,
      slug: stamp,
      ownerEmail: `${stamp}@csq.local`,
      ownerName: "Billing Check",
      ownerPassword: "billing-check-password",
    });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    check(
      "createTenantWithOwner defaults",
      tenant.status === "ACTIVE" &&
        owner.role === "OWNER" &&
        owner.tenantId === tenantId &&
        typeof tenant.settings === "object" &&
        tenant.settings !== null &&
        "sourcePriority" in tenant.settings,
      `status ${tenant.status}, role ${owner.role}`
    );

    // Entitlements: a tenant with no plan is legacy (unlimited, all features).
    const legacy = await getTenantEntitlements(tenantId);
    check(
      "legacy tenant is unlimited",
      legacy.planName === null && legacy.aiCreditsPerMonth === null
    );

    // Assign a tiny scratch plan to make limits observable.
    const plan = await prisma.plan.create({
      data: {
        name: stamp,
        priceIdr: 1000,
        aiCreditsPerMonth: 2,
        staffLimit: 1,
        channelLimit: 1,
        features: [],
      },
    });
    await prisma.tenant.update({ where: { id: tenantId }, data: { planId: plan.id } });
    const entitled = await getTenantEntitlements(tenantId);
    check(
      "plan entitlements apply",
      entitled.planName === stamp && entitled.aiCreditsPerMonth === 2
    );

    // Ledger idempotency: the same ref charges once.
    await chargeCredits({ tenantId, source: "REPLY", refId: "billing-check-1" });
    await chargeCredits({ tenantId, source: "REPLY", refId: "billing-check-1" });
    await chargeCredits({
      tenantId,
      source: "SCENARIO_MODULE",
      refId: "billing-check-2",
    });
    const afterTwo = await getCreditStatus(tenantId);
    check("chargeCredits is idempotent per ref", afterTwo.used === 2, `used ${afterTwo.used}`);

    // Exhaustion at the limit.
    await chargeCredits({ tenantId, source: "REPLY", refId: "billing-check-3" });
    const afterThree = await getCreditStatus(tenantId);
    check(
      "credit hard stop at limit",
      afterThree.used === 3 && afterThree.limit === 2 && afterThree.exhausted
    );

    // COR-4: usage meters read the ledger with the reply/module split, never
    // derived message counts (there are no messages in this tenant).
    const usage = await getTenantUsage(tenantId, monthStartUtc());
    check(
      "usage meters come from the ledger",
      usage.creditsUsed === 3 &&
        usage.replyCredits === 2 &&
        usage.moduleCredits === 1 &&
        usage.agentReplies === 0,
      `used ${usage.creditsUsed}, replies ${usage.replyCredits}, modules ${usage.moduleCredits}`
    );

    // COR-5: the partial unique index makes a second open request collide.
    await prisma.planRequest.create({
      data: { tenantId, requestedPlanId: plan.id, note: "open" },
    });
    let collided = false;
    try {
      await prisma.planRequest.create({
        data: { tenantId, requestedPlanId: plan.id, note: "duplicate" },
      });
    } catch (err) {
      collided =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    }
    check("one open plan request per tenant (index enforced)", collided);

    // Cleanup.
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.plan.delete({ where: { id: plan.id } });
  });

  if (failures > 0) {
    console.error(`[billing] ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("[billing] all checks passed");
}

main()
  .catch((err: unknown) => {
    console.error("[billing] check crashed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
