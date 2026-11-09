#!/usr/bin/env bash
# One-shot VPS setup for CSQ on a fresh Ubuntu host
# (4 vCPU / 4GB RAM / 20GB SSD). Idempotent. Run as root:
#   bash docker/setup-vps.sh
#
# PREREQUISITE - PREBUILT IMAGES: this script does NOT build on the 4GB VPS
# (the Next.js build will OOM; see docker/Dockerfile header). Prebuild the
# dashboard, api, worker and nginx images elsewhere (CI or a beefier
# machine), push them to a registry, and set in .env.production:
#   CSQ_APP_IMAGE=ghcr.io/yourorg/csq-app:latest
#   CSQ_API_IMAGE=ghcr.io/yourorg/csq-api:latest
#   CSQ_WORKER_IMAGE=ghcr.io/yourorg/csq-worker:latest
#   CSQ_NGINX_IMAGE=ghcr.io/yourorg/csq-nginx:latest
# This script runs `docker compose pull` to fetch them.
#
# PREREQUISITE - TLS CERT: you MUST run init-certbot.sh BEFORE this script
# (or at least before the first successful `up`). Nginx requires the cert
# files to exist at startup, and the certbot compose service only renews;
# it does not issue the initial certificate. This script checks for the cert
# and exits with instructions if it is missing.
#
# The services drive the configured OpenAI-compatible LLM provider directly
# over HTTPS - no sidecar containers. Postgres runs on the VPS (pgvector
# image), not Neon.
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
  echo "Missing $REPO_DIR/.env.production - copy .env.production.example and fill it in." >&2
  exit 1
fi

# TLS gate: Nginx will fail to start without a cert for CERT_DOMAIN.
if [ -z "${CERT_DOMAIN:-}" ]; then
  echo "CERT_DOMAIN is not set in .env.production - set it and re-run." >&2
  exit 1
fi
CERT_DIR="$REPO_DIR/docker/certbot/conf/live/${CERT_DOMAIN}"
if [ ! -d "$CERT_DIR" ]; then
  echo "==> TLS certificate not found for CERT_DOMAIN=${CERT_DOMAIN}" >&2
  echo "    Run init-certbot.sh FIRST to issue the initial cert:" >&2
  echo "      CERT_DOMAIN=${CERT_DOMAIN} EMAIL=you@example.com ./docker/certbot/init-certbot.sh" >&2
  echo "    Then re-run this script." >&2
  exit 1
fi

cd "$REPO_DIR/docker"

echo "==> Pulling prebuilt images (app=${CSQ_APP_IMAGE:-csq/app:latest}, api=${CSQ_API_IMAGE:-csq/api:latest}, worker=${CSQ_WORKER_IMAGE:-csq/worker:latest}, nginx=${CSQ_NGINX_IMAGE:-csq/nginx:latest})"
docker compose --env-file "$REPO_DIR/.env.production" pull

echo "==> Starting dashboard + api + worker + postgres + nginx + certbot"
docker compose --env-file "$REPO_DIR/.env.production" up -d

echo "==> Waiting for health checks"
sleep 10

echo "==> Done."
echo "    Health checks:"
echo "      dashboard: curl -sf https://${CERT_DOMAIN}/api/health"
echo "      api:       curl -sf https://${CERT_DOMAIN}/api/v1/openapi > /dev/null"
echo "      worker:    curl -sf http://127.0.0.1:10000"
