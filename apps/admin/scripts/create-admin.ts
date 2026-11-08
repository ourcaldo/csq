import { randomBytes } from "crypto";
import prisma from "@csq/core/lib/db";
import { hashPassword } from "@csq/core/lib/password";

// Bootstrap the first operator (PRD 13). Run from apps/admin:
//   npm run admin:create -- --email ops@csq.id --name "Operator"
// Prompts for the password on stdin (never an argv flag - shell history).
// Idempotent: creating an existing email updates nothing and exits 1.
import * as readline from "readline/promises";

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

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.error(`Admin ${email} already exists.`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question("Password: ", { hideEchoBack: true } as never);
  await rl.close();
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const admin = await prisma.adminUser.create({
    data: { email, name, passwordHash: await hashPassword(password) },
  });
  console.log(`Admin created: ${admin.email} (${admin.id})`);
  process.exit(0);
}

void main();
