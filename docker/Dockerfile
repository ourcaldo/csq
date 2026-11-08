# syntax=docker/dockerfile:1
# Multi-stage build for CSQ (Next.js standalone) from the npm-workspaces
# monorepo. The app talks to the configured OpenAI-compatible LLM provider
# over HTTPS - no sidecar CLIs needed. Never build on the 4GB VPS - build
# elsewhere / in CI and pull, or build on a beefier machine and load.

# -- builder --
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Workspace manifests first: npm ci needs every workspace package.json to
# match the root lockfile.
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json ./apps/dashboard/
RUN npm ci

COPY apps/dashboard/prisma ./apps/dashboard/prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# -- runner --
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# ca-certificates is needed for HTTPS calls the app makes to external APIs
# (WhatsApp Graph API, Google Sheets, the LLM provider). No other apt
# packages are required.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Next standalone output mirrors the monorepo layout: server.js lives at
# apps/dashboard/server.js inside the bundle, with the traced node_modules at
# the bundle root. Static assets and public must sit next to the app.
COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public

# Prisma: schema + migrations for migrate deploy, the generated client
# (tracing can miss the query engine binary), and the CLI to run it.
COPY --from=builder /app/apps/dashboard/prisma ./apps/dashboard/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

EXPOSE 3000

# Apply migrations (never `migrate dev` in prod) then start the standalone
# server. The prisma CLI is invoked directly - npx/.bin shims are not
# guaranteed inside the trimmed runner image.
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy --schema apps/dashboard/prisma/schema.prisma && node apps/dashboard/server.js"]
