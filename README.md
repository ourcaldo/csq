# CSQ
Self-hosted, multi-tenant AI agent platform for Indonesian UMKM. HackFest MVP: a Customer Service Agent on WhatsApp that reads the business's own messy data (manual, Excel/CSV, Google Sheets) and performs controlled writes under per-tool permissions. Built on Next.js (Pages Router) + PostgreSQL/Prisma/pgvector + OpenClaw + WhatsApp Cloud API.

## Self-hosted deployment (PRD §22A.1)

Target host: a fresh Ubuntu VPS with 4 vCPU / 4GB RAM / 20GB SSD and root access. Docker is installed by `setup-vps.sh` if missing.

### 1. Prebuild the Docker images (do NOT build on the 4GB VPS)

The Next.js production build will OOM on the 4GB host. Build the app and nginx images on a beefier machine or in CI, then push them to a registry:

```bash
# From the repo root (on your build machine):
docker build -f docker/Dockerfile -t ghcr.io/yourorg/csq-app:latest .
docker build -f docker/nginx/Dockerfile -t ghcr.io/yourorg/csq-nginx:latest docker/nginx/
docker push ghcr.io/yourorg/csq-app:latest
docker push ghcr.io/yourorg/csq-nginx:latest
```

### 2. Prepare the environment

Clone the repo onto the VPS and create the production env file:

```bash
git clone <your-repo-url> /opt/csq && cd /opt/csq
cp .env.production.example .env.production
```

Edit `.env.production` and fill in:

- **`POSTGRES_PASSWORD`** — a strong password (also update it in `DATABASE_URL` and `DATABASE_URL_UNPOOLED`).
- **`NEXTAUTH_URL`** — your domain, e.g. `https://umkm.example.com`.
- **`NEXTAUTH_SECRET`** — generate with `openssl rand -base64 32`.
- **`CERT_DOMAIN`** — the same domain, e.g. `umkm.example.com`.
- **`CSQ_APP_IMAGE`** / **`CSQ_NGINX_IMAGE`** — the registry image names you pushed in step 1.
- **`OPENCLAW_API_KEY`** / **`FIREWORKS_API_KEY`** — your Fireworks API key (used to configure each tenant's OpenClaw cell).
- **`WHATSAPP_APP_SECRET`** — the App Secret from your Meta app (used for webhook HMAC validation).
- **`GOOGLE_CLIENT_ID`** / **`GOOGLE_CLIENT_SECRET`** / **`GOOGLE_REDIRECT_URI`** — for Google Sheets OAuth (optional, only if stores import from Sheets).

Other WhatsApp Cloud API credentials (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, etc.) are entered per-store through the dashboard UI and stored in the database — they are not read from env. See `.env.production.example` for details.

### 3. Issue the TLS certificate

Nginx requires the cert files to exist before it starts. Run `init-certbot.sh` **before** starting the stack:

```bash
CERT_DOMAIN=umkm.example.com EMAIL=you@example.com ./docker/certbot/init-certbot.sh
```

This uses a standalone certbot container (Nginx does not need to be running). The cert is stored under `docker/certbot/conf/` and mounted into the nginx container at runtime.

### 4. Start the stack

```bash
bash docker/setup-vps.sh
```

This script is idempotent. It will:
- Update apt packages and install Docker if missing.
- Configure UFW (SSH/HTTP/HTTPS only).
- Verify the TLS cert exists for `CERT_DOMAIN` (exits with instructions if not — run step 3 first).
- Pull the prebuilt images from the registry (`docker compose pull`).
- Start app + postgres + nginx + certbot (`docker compose up -d`).

The certbot service in compose handles automatic renewal (runs `certbot renew` every 12h).

### 5. Health check

```bash
curl -sf https://umkm.example.com/api/health
```

A `200 OK` means the app is running and the database is reachable.

### 6. Demo tenant (optional)

A clean production install does NOT seed the demo tenant — owners register their own stores at `/register`. To seed the demo tenant (Toko Kopi Nusantara) for a preview:

```bash
cd docker
docker compose --env-file ../.env.production exec -T app npx prisma db seed
```

Demo login: `admin@tokokopi.id` / `demo1234` (check `prisma/seed.ts` for the current credentials).
