import { PrismaClient } from "@prisma/client";

// The only place PrismaClient is instantiated. Every query imports `prisma`
// from here. The global cache prevents connection exhaustion during Next.js
// dev hot-reloads. No `as` casting — `declare global` types the cache slot.
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prisma = globalThis.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

export default prisma;
