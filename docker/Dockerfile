# syntax=docker/dockerfile:1
# Multi-target build for the CSQ monorepo. Build on a machine with enough
# memory (never on the 4GB VPS): docker build --target dashboard|api|worker.
#
# The dashboard and api targets use Next standalone output. The worker runs
# TypeScript through tsx and needs the full workspace + dev dependencies, so
# its image is larger.

# -- dependencies: every workspace manifest must match the root lockfile --
FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/
COPY packages/ui/package.json ./packages/ui/
RUN npm ci

# -- build: generate Prisma, then compile the two Next apps --
FROM deps AS build
COPY packages/core/prisma ./packages/core/prisma
RUN npx prisma generate
COPY . .
RUN npm run build -w apps/dashboard
RUN npm run build -w apps/api

# -- shared runner base --
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# -- dashboard --
FROM runner AS dashboard
ENV PORT=3000

COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public

COPY --from=build /app/packages/core/prisma ./packages/core/prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma

EXPOSE 3000
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy --schema packages/core/prisma/schema.prisma && node apps/dashboard/server.js"]

# -- api (token realm, Tool Gateway, Meta webhook, media) --
FROM runner AS api
ENV PORT=3000

COPY --from=build /app/apps/api/.next/standalone ./
COPY --from=build /app/apps/api/.next/static ./apps/api/.next/static

COPY --from=build /app/packages/core/prisma ./packages/core/prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma

EXPOSE 3000
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy --schema packages/core/prisma/schema.prisma && node apps/api/server.js"]

# -- worker (sockets, ticks, outbox, commands) --
FROM runner AS worker
ENV PORT=10000

# The worker executes TypeScript with tsx and resolves @csq/core through the
# root tsconfig paths, so it needs the workspace sources and dev deps.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/apps/dashboard/tsconfig.json ./apps/dashboard/tsconfig.json

EXPOSE 10000
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy --schema packages/core/prisma/schema.prisma && npx tsx apps/worker/src/main.ts"]
