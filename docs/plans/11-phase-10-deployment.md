# Phase 10 — Deployment (Docker Compose, Nginx, TLS)

**Goal:** Package the entire application for production deployment on the
HackFest VPS (4 vCPU, 4GB RAM, 20GB SSD Ubuntu). Includes Docker images,
Nginx reverse proxy, TLS via Certbot, and a production docker-compose setup.
**PRD Reference:** Sections 22A, 23A (Deployment), 23B.1 (docker/ layout)
**Depends On:** All previous phases

---

## Tasks

### 10.1 Production Dockerfile

- [ ] Create `docker/Dockerfile`:
  ```dockerfile
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN npx prisma generate
  RUN npm run build

  FROM node:20-alpine AS runner
  WORKDIR /app
  ENV NODE_ENV=production
  COPY --from=builder /app/.next/standalone ./
  COPY --from=builder /app/.next/static ./.next/static
  COPY --from=builder /app/prisma ./prisma
  COPY --from=builder /app/public ./public
  COPY --from=builder /app/node_modules ./node_modules
  EXPOSE 3000
  CMD ["node", "server.js"]
  ```
- [ ] Multi-stage build: builder compiles, runner is minimal.
- [ ] Add `output: "standalone"` to `next.config.js` for standalone output mode.
- [ ] Copy Prisma generated client to runner stage.

### 10.2 Production docker-compose

- [ ] Create `docker/docker-compose.yml`:
  ```yaml
  services:
    app:
      build:
        context: ..
        dockerfile: docker/Dockerfile
      ports:
        - "127.0.0.1:3000:3000"
      environment:
        - DATABASE_URL=${DATABASE_URL}
        - NEXTAUTH_URL=${NEXTAUTH_URL}
        - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
        - WHATSAPP_TOKEN=${WHATSAPP_TOKEN}
        - WHATSAPP_PHONE_NUMBER_ID=${WHATSAPP_PHONE_NUMBER_ID}
        - WHATSAPP_VERIFY_TOKEN=${WHATSAPP_VERIFY_TOKEN}
        - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
        - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
        - GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}
        - OPENCLAW_BASE_URL=${OPENCLAW_BASE_URL}
        - OPENCLAW_API_KEY=${OPENCLAW_API_KEY}
      depends_on:
        postgres:
          condition: service_healthy
      restart: unless-stopped

    postgres:
      image: pgvector/pgvector:pg16
      environment:
        POSTGRES_DB: umkm_prod
        POSTGRES_USER: umkm
        POSTGRES_PASSWORD: ${DB_PASSWORD}
      volumes:
        - pgdata:/var/lib/postgresql/data
      ports:
        - "127.0.0.1:5432:5432"
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U umkm"]
        interval: 10s
        timeout: 5s
        retries: 5
      restart: unless-stopped

  volumes:
    pgdata:
  ```
- [ ] Note: OpenClaw Gateway is NOT included yet (pending Phase 6 validation).
  Add as a separate service once integration method is confirmed.

### 10.3 Nginx reverse proxy

- [ ] Create `docker/nginx/nginx.conf`:
  - Listen on port 80 (HTTP) and 443 (HTTPS).
  - Proxy `/` to `app:3000`.
  - WebSocket support for any future real-time features.
  - Gzip compression for static assets.
  - Security headers (X-Frame-Options, X-Content-Type-Options, etc.).
  - Rate limiting on `/api/webhooks/*` (prevent abuse).
- [ ] Create `docker/nginx/Dockerfile` (alpine-based nginx image).
- [ ] Add nginx service to docker-compose.yml:
  ```yaml
  nginx:
    build: ./nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - certbot-etc:/etc/letsencrypt:ro
      - certbot-var:/var/lib/letsencrypt
    depends_on:
      - app
    restart: unless-stopped
  ```

### 10.4 TLS with Certbot

- [ ] Create `docker/certbot/init-certbot.sh`:
  - Script to obtain initial TLS certificate using Certbot.
  - `certbot certonly --webroot -w /var/www/certbot -d yourdomain.com`
- [ ] Add certbot service to docker-compose.yml (one-time container for renewal).
- [ ] Configure nginx to use Let's Encrypt certificates.
- [ ] Add certbot renewal cron (or systemd timer) on the VPS.
- [ ] **TLS is required** for WhatsApp webhook (Meta requires HTTPS).

### 10.5 VPS setup script

- [ ] Create `docker/setup-vps.sh`:
  - Update system packages.
  - Install Docker + Docker Compose.
  - Clone repo (or copy files).
  - Copy `.env.production` to server.
  - Run `docker compose -f docker/docker-compose.yml up -d`.
  - Run `npx prisma migrate deploy` (production migrations).
  - Run `npx prisma db seed` (optional — if demo data needed).
  - Configure firewall (allow 80, 443 only).
- [ ] Make the script idempotent (safe to run multiple times).

### 10.6 Production environment template

- [ ] Create `.env.production.example`:
  ```
  DATABASE_URL=postgresql://umkm:STRONG_PASSWORD@postgres:5432/umkm_prod
  DB_PASSWORD=STRONG_PASSWORD
  NEXTAUTH_URL=https://yourdomain.com
  NEXTAUTH_SECRET=GENERATE_WITH_OPENSSL_RAND_BASE64_32
  WHATSAPP_TOKEN=
  WHATSAPP_PHONE_NUMBER_ID=
  WHATSAPP_VERIFY_TOKEN=RANDOM_STRING
  GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=
  GOOGLE_REDIRECT_URI=https://yourdomain.com/api/import/sheets/callback
  OPENCLAW_BASE_URL=
  OPENCLAW_API_KEY=
  ```

### 10.7 Database migration strategy

- [ ] Production migrations: `npx prisma migrate deploy` (no interactive prompts).
- [ ] Run migrations as a separate step before starting the app container,
  or as a docker-compose `entrypoint` script.
- [ ] Never run `prisma migrate dev` in production.

### 10.8 Health check endpoint

- [ ] Create `src/pages/api/health.ts`:
  - `GET` — returns `{ status: "ok", timestamp }` if app and DB are reachable.
  - Used by Docker healthcheck and monitoring.
- [ ] Add healthcheck to app service in docker-compose.yml.

### 10.9 Logging

- [ ] Next.js logs to stdout/stderr (captured by Docker).
- [ ] `docker compose logs -f app` for real-time viewing.
- [ ] No external log aggregation for MVP (ELK, Datadog, etc. — out of scope).
- [ ] Consider adding `pino` or structured logging if time allows — not required.

### 10.10 Backup strategy (minimal)

- [ ] Document backup command: `docker exec postgres pg_dump -U umkm umkm_prod > backup.sql`
- [ ] Add to setup script or README.
- [ ] No automated backups for MVP (manual, documented).

---

## Build Gate

- [ ] `docker compose -f docker/docker-compose.yml build` — builds without errors.
- [ ] `docker compose -f docker/docker-compose.yml up -d` — all containers start.
- [ ] `curl http://localhost/api/health` → `{ status: "ok" }`.
- [ ] `curl https://yourdomain.com` → dashboard loads (after TLS setup).
- [ ] WhatsApp webhook verification works over HTTPS.
- [ ] Full demo flow works on production deployment.

---

## Files Created/Modified

```
docker/
├── Dockerfile                  (multi-stage Next.js build)
├── docker-compose.yml          (production: app + postgres + nginx)
├── docker-compose.dev.yml      (dev: postgres only, from Phase 0)
├── nginx/
│   ├── Dockerfile
│   └── nginx.conf
├── certbot/
│   └── init-certbot.sh
└── setup-vps.sh                (one-time VPS provisioning)

.env.production.example

src/
└── pages/api/
    └── health.ts
```

---

## RAM Budget (4GB total)

| Component | Estimated RAM |
|-----------|--------------|
| PostgreSQL (pgvector) | ~300-500MB |
| Next.js app | ~200-400MB |
| Nginx | ~20MB |
| Node.js (node-cron + runtime) | ~100MB (included in Next.js) |
| OpenClaw Gateway (TBD) | ~200-500MB? |
| OS overhead | ~200MB |
| **Total (without OpenClaw)** | **~820-1020MB** |
| **Total (with OpenClaw)** | **~1020-1520MB** |

We have headroom, but it's not unlimited. OpenClaw's actual footprint is the
variable. If it exceeds 1GB, we may need to optimize or run it on a separate
container with memory limits.

---

## Notes

- Don't over-engineer deployment. The HackFest demo is on a single VPS — no
  Kubernetes, no auto-scaling, no CDN.
- TLS is non-negotiable (WhatsApp webhook requirement).
- The `setup-vps.sh` script should be the only thing a judge needs to deploy
  the project. Make it simple and well-documented.
- Add a `README.md` at project root with quickstart instructions (if not done
  in Phase 0).
