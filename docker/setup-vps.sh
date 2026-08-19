#!/usr/bin/env bash
# One-shot VPS setup for CSQ on a fresh Ubuntu host
# (HackFest: 4 vCPU / 4GB RAM / 20GB SSD). Idempotent. Run as root:
#   bash docker/setup-vps.sh
#
# Production model (PRD §5/§26): per-tenant OpenClaw cells. The app container
# builds the `openclaw` + `docker` CLIs (see Dockerfile) and provisions one
# isolated OpenClaw container per store via `openclaw fleet create <slug>`
# against the host Docker daemon (socket mounted in docker-compose.yml).
# Postgres runs on the VPS (pgvector image), not Neon.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Updating packages"
apt-get update -y && apt-get upgrade -y

echo "==> Installing Docker + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Firewall: allow SSH, HTTP, HTTPS only"
if command -v ufw >/dev/null 2>&1; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow ssh
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

echo "==> Loading environment"
if [ -f "$REPO_DIR/.env.production" ]; then
  set -a; . "$REPO_DIR/.env.production"; set +a
else
  echo "Missing $REPO_DIR/.env.production — copy .env.production.example and fill it in." >&2
  exit 1
fi

cd "$REPO_DIR/docker"

echo "==> Building and starting app + postgres + nginx (OpenClaw cells spawn on demand)"
docker compose --env-file "$REPO_DIR/.env.production" up -d --build

echo "==> Waiting for postgres health"
sleep 5

# A clean production install does NOT seed the demo tenant — owners register
# their own stores from /register. To seed the demo tenant for a throwaway
# preview, uncomment the block below.
# echo "==> Seeding demo tenant (optional)"
# docker compose --env-file "$REPO_DIR/.env.production" exec -T app \
#   npx prisma db seed || true

echo "==> Done."
echo "    Obtain TLS certs with: CERT_DOMAIN=... EMAIL=... ./certbot/init-certbot.sh"
echo "    then restart nginx: docker compose --env-file ../.env.production restart nginx"
echo "    OpenClaw cells are provisioned automatically when owners register + deploy agents."
