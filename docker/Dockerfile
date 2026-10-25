# syntax=docker/dockerfile:1
# Multi-stage build for CSQ (Next.js standalone). The app talks to the
# configured OpenAI-compatible LLM provider over HTTPS — no sidecar CLIs
# needed. Never build on the 4GB VPS — build elsewhere / in CI and pull,
# or build on a beefier machine and load.

# ── builder ──
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# ── runner ──
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

# Next standalone server bundle + static assets + public.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma: schema + migrations for `migrate deploy`, and the generated client.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Prisma CLI for `migrate deploy` at startup.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

EXPOSE 3000

# Apply migrations (never `migrate dev` in prod) then start the standalone server.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
