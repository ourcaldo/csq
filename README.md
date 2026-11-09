# CSQ
Self-hosted, multi-tenant AI agent platform for Indonesian UMKM. A Customer Service Agent on WhatsApp that reads the business's own messy data (manual, Excel/CSV, Google Sheets) and performs controlled writes under per-tool permissions. Built on Next.js (Pages Router) + PostgreSQL/Prisma/pgvector + any OpenAI-compatible LLM provider + WhatsApp Cloud API.

## Self-hosted deployment (PRD §22A.1)

Target host: a fresh Ubuntu VPS with 4 vCPU / 4GB RAM / 20GB SSD and root access. Docker is installed by `setup-vps.sh` if missing.

### 1. Prebuild the Docker images (do NOT build on the 4GB VPS)

The Next.js production build will OOM on the 4GB host. Build the app and nginx images on a beefier machine or in CI, then push them to a registry:

```bash
# From the repo root (on your build machine):
docker build -f docker/Dockerfile --target dashboard -t ghcr.io/yourorg/csq-app:latest .
docker build -f docker/Dockerfile --target api -t ghcr.io/yourorg/csq-api:latest .
docker build -f docker/Dockerfile --target worker -t ghcr.io/yourorg/csq-worker:latest .
docker build -f docker/nginx/Dockerfile -t ghcr.io/yourorg/csq-nginx:latest docker/nginx/
docker push ghcr.io/yourorg/csq-app:latest
docker push ghcr.io/yourorg/csq-api:latest
docker push ghcr.io/yourorg/csq-worker:latest
docker push ghcr.io/yourorg/csq-nginx:latest
```

### 2. Prepare the environment

Clone the repo onto the VPS and create the production env file:

```bash
git clone <your-repo-url> /opt/csq && cd /opt/csq
cp apps/dashboard/.env.production.example .env.production
```

Edit `.env.production` and fill in:

- **`POSTGRES_PASSWORD`** — a strong password (also update it in `DATABASE_URL` and `DATABASE_URL_UNPOOLED`).
- **`NEXTAUTH_URL`** — your domain, e.g. `https://umkm.example.com`.
- **`NEXTAUTH_SECRET`** — generate with `openssl rand -base64 32`.
- **`CERT_DOMAIN`** — the same domain, e.g. `umkm.example.com`.
- **`CSQ_APP_IMAGE`** / **`CSQ_API_IMAGE`** / **`CSQ_WORKER_IMAGE`** / **`CSQ_NGINX_IMAGE`** — the registry image names you pushed in step 1.
- **`API_JWT_SECRET`** — signs the `/api/v1` user access JWTs. Generate with `openssl rand -base64 32`.
- **`API_SERVICE_TOKEN`** — the shared token the dashboard BFF sends to the api service. Generate a long random string; the api accepts it via `API_SERVICE_TOKENS`.
- **`LLM_API_KEY`** / **`LLM_BASE_URL`** / **`LLM_CHAT_MODEL`** — any OpenAI-compatible LLM provider. Serves the agent loop, scenario AI node, and embeddings.
- **`WHATSAPP_APP_SECRET`** — the App Secret from your Meta app (used for webhook HMAC validation).
- **`GOOGLE_CLIENT_ID`** / **`GOOGLE_CLIENT_SECRET`** / **`GOOGLE_REDIRECT_URI`** — for Google Sheets OAuth (optional, only if stores import from Sheets).

#### Database: self-hosted or managed — choose one

- **Mode A — self-hosted (default).** Keep `POSTGRES_*` and the compose
  `postgres` service; `DATABASE_URL` points at `postgres:5432` on the compose
  network. Nothing else to do.
- **Mode B — managed Postgres (Neon, or any provider with pgvector).** Set
  `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct — used by
  `prisma migrate deploy`) to the managed endpoints. The compose `postgres`
  service is unused in this mode and may be removed from the stack
  (`docker compose up app nginx certbot`). Do not run the local `postgres`
  service against the same database.

Both modes require pgvector (`pgvector/pgvector:pg16` in Mode A; Neon has it
built in). All other setup is identical.

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
- Start app + api + worker + postgres + nginx + certbot (`docker compose up -d`).

The certbot service in compose handles automatic renewal (runs `certbot renew` every 12h).

### 5. Health check

```bash
curl -sf https://umkm.example.com/api/health          # dashboard
curl -sf https://umkm.example.com/api/v1/openapi      # api
curl -sf http://127.0.0.1:10000                       # worker (host only)
```

A `200 OK` means the service is running and the database is reachable.

### 5b. Backups

Back up the database daily (Mode A self-hosted; for managed Postgres use the provider's PITR):

```bash
docker compose --env-file .env.production exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > /opt/backups/csq-$(date +%F).sql.gz
```

Schedule it with cron and copy the dumps off the host.

### 6. Demo tenant (optional)

A clean production install does NOT seed the demo tenant — owners register their own stores at `/register`. To seed the demo tenant (Toko Kopi Nusantara) for a preview:

```bash
cd docker
docker compose --env-file ../.env.production exec -T app npx prisma db seed --schema packages/core/prisma/schema.prisma
```

Demo login: `admin@tokokopi.id` / `demo1234` (check `packages/core/prisma/seed.ts` for the current credentials).
