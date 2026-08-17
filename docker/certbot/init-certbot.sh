#!/usr/bin/env bash
# Obtain the initial Let's Encrypt certificate for ${CERT_DOMAIN}, then restart
# Nginx so it picks up the certs. Run once before bringing the stack up fully:
#   CERT_DOMAIN=umkm.example.com EMAIL=you@example.com ./docker/certbot/init-certbot.sh
# After this, `docker compose up -d` starts Nginx with valid TLS.
set -euo pipefail

: "${CERT_DOMAIN:?CERT_DOMAIN is required (e.g. umkm.example.com)}"
: "${EMAIL:?EMAIL is required for Let's Encrypt}"
CERT_DIR="$(cd "$(dirname "$0")" && pwd)/certbot"

mkdir -p "$CERT_DIR/conf" "$CERT_DIR/www"

# Standalone certbot issues a cert using its own temporary HTTP server, so Nginx
# does not need to be running yet.
docker run --rm \
  -v "$CERT_DIR/conf:/etc/letsencrypt" \
  -v "$CERT_DIR/www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  --email "$EMAIL" --agree-tos --no-eff-email \
  -d "$CERT_DOMAIN"

echo "Certificate issued for $CERT_DOMAIN. You can now start the stack:"
echo "  docker compose --env-file ../.env.production up -d"
