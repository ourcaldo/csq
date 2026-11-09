import { randomBytes } from "crypto";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { hashPassword } from "@csq/core/lib/password";

// Bootstrap the first operator (PRD 13). Run from apps/admin:
//   npm run admin:create -- --email ops@csq.id --name "Operator"
// SEC-5 (PRD 16): the password is GENERATED and printed exactly once.
// Node's readline cannot hide stdin echo, so a prompted password would be
// visible on the terminal and in scrollback - a one-time generated
// password avoids the leak; the operator changes it after first login.
// Idempotent: creating an existing email updates nothing and exits 1.

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(24);
  let out = "";
  for (const b of bytes) {
    out += alphabet[b % alphabet.length];
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const emailIdx = args.indexOf("--email");
  const nameIdx = args.indexOf("--name");
  const email = emailIdx !== -1 ? args[emailIdx + 1] : undefined;
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;

  if (!email || !name) {
    console.error("Usage: npm run admin:create -- --email <email> --name <name>");
    process.exit(1);
  }

  await withSystemContext(async () => {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      console.error(`Admin ${email} already exists.`);
      process.exit(1);
    }

    const password = generatePassword();
    const admin = await prisma.adminUser.create({
      data: {
        email,
        name,
        role: "SUPERADMIN",
        passwordHash: await hashPassword(password),
      },
    });
    console.log(`Admin created: ${admin.email} (${admin.id})`);
    console.log("One-time password (shown once, change it after first login):");
    console.log(password);
  });
  process.exit(0);
}

void main().finally(() => {
  void prisma.$disconnect();
});
