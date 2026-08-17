#!/usr/bin/env bash
# One-shot VPS setup for CSQ on a fresh Ubuntu host
# (HackFest: 4 vCPU / 4GB RAM / 20GB SSD). Idempotent. Run as root:
#   bash docker/setup-vps.sh
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

echo "==> Building and starting app + postgres + nginx"
docker compose --env-file "$REPO_DIR/.env.production" up -d --build

echo "==> Waiting for postgres health"
sleep 5

echo "==> Seeding demo tenant (optional — remove for clean installs)"
docker compose --env-file "$REPO_DIR/.env.production" exec -T app \
  npx prisma db seed || true

echo "==> Done. Obtain TLS certs with: CERT_DOMAIN=... EMAIL=... ./certbot/init-certbot.sh"
echo "    then restart nginx: docker compose --env-file ../.env.production restart nginx"
