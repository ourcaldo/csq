# syntax=docker/dockerfile:1
# Multi-stage build for CSQ (Next.js standalone) + the OpenClaw + docker CLIs so
# the app can provision per-tenant OpenClaw cells (PRD §5/§26) via the host
# Docker socket (see docker-compose.yml). Never build on the 4GB VPS — build
# elsewhere / in CI and pull, or build on a beefier machine and load.

# ── builder ──
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# ── OpenClaw CLI stage (copied from the official slim image) ──
# Used by src/services/openclaw-cell.ts to run `openclaw fleet create` and
# `docker exec <cell> openclaw agents add …`. The slim image ships the CLI at
# /app/dist/index.js with a /usr/local/bin/openclaw wrapper; we copy /app and
# recreate the wrapper against the runner's node.
FROM ghcr.io/openclaw/openclaw:slim AS openclaw-cli

# ── docker CLI stage (copied from the official docker image; CLI only) ──
# The app needs the `docker` binary to run `docker exec <cell>` against the
# host Docker daemon via /var/run/docker.sock. We copy just the CLI binary
# from the official docker:cli image instead of installing the docker.io apt
# metapackage (which pulls the full Docker engine and adds ~200 MB).
FROM docker:24-cli AS docker-cli

# ── runner ──
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# ca-certificates is needed for HTTPS calls the app makes to external APIs
# (WhatsApp Graph API, Google Sheets, Fireworks). No other apt packages are
# required — the docker CLI binary is copied from the stage above.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# docker CLI — lets the app talk to the host Docker daemon through the mounted
# /var/run/docker.sock (manage cell containers via `docker exec <cell>`).
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

# OpenClaw CLI.
COPY --from=openclaw-cli /app /opt/openclaw
RUN printf '#!/bin/sh\nexec node /opt/openclaw/dist/index.js "$@"\n' \
      > /usr/local/bin/openclaw && chmod +x /usr/local/bin/openclaw
# Fleet state lives under OPENCLAW_STATE_DIR; mounted as a volume in compose
# so cell metadata survives app restarts.
ENV OPENCLAW_STATE_DIR=/data/.openclaw

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
