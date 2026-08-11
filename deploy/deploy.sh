#!/usr/bin/env bash
# Mavino — VPS deployment script.
# Run ON the VPS (tevuori@vps.tevuori.eu) from the repo root after cloning.
#
# What it does:
#   1. Generates a strong JWT_SECRET + SEED_PASSWORD into .env (if missing).
#   2. Builds + starts the Docker Compose stack (client on 127.0.0.1:8080,
#      server internal-only).
#   3. Runs prisma migrate deploy + seed inside the server container.
#   4. Installs the host nginx site for mavino.net.
#   5. Runs certbot to obtain + install the TLS certificate.
#
# Prereqs on the VPS: git, docker, docker compose, nginx, certbot,
# python3-certbot-nginx. DNS for mavino.net must already point here.

set -euo pipefail

DOMAIN="mavino.net"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "==> Mavino VPS deploy for $DOMAIN"

# --- 1. .env with strong secrets ---
if [ ! -f .env ]; then
  echo "==> Generating .env with strong secrets"
  JWT_SECRET="$(openssl rand -hex 32)"
  ENC_KEY="$(openssl rand -hex 32)"
  SEED_PW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  PG_PW="$(openssl rand -hex 24)"
  cp .env.example .env
  # Replace key values
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENC_KEY|" .env
  sed -i "s|^SEED_PASSWORD=.*|SEED_PASSWORD=$SEED_PW|" .env
  sed -i "s|^CLIENT_ORIGIN=.*|CLIENT_ORIGIN=https://$DOMAIN|" .env
  sed -i "s|^SANDBOX_ENABLED=.*|SANDBOX_ENABLED=false|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PW|" .env
  # Write seed credentials to a restricted file instead of stdout.
  CRED_FILE=".seed-credentials.txt"
  cat > "$CRED_FILE" <<EOF
Mavino — Initial Admin Credentials
===================================
  Service:   https://$DOMAIN
  Username:  admin
  Password:  $SEED_PW

IMPORTANT: You will be FORCED to change this password on first login.
Delete this file after you have successfully logged in and changed the password.
===================================
EOF
  chmod 600 "$CRED_FILE"
  echo ""
  echo "============================================================"
  echo "  Seed admin credentials written to: $CRED_FILE (chmod 600)"
  echo "  Read them with: cat $CRED_FILE"
  echo "  You will be FORCED to change the password on first login."
  echo "  Delete the file after first login: rm $CRED_FILE"
  echo "============================================================"
  echo ""
else
  echo "==> .env already exists — leaving secrets as-is"
fi

# --- 2. Build + start Docker stack ---
echo "==> Building + starting Docker Compose stack"
docker compose up --build -d

# --- 3. Run migrations + seed inside the server container ---
echo "==> Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U "${POSTGRES_USER:-athena}" -d "${POSTGRES_DB:-athena}" >/dev/null 2>&1; then
    echo "    PostgreSQL is ready."
    break
  fi
  echo "    Waiting... ($i/30)"
  sleep 2
done

echo "==> Running prisma migrate deploy"
docker compose exec -T server bunx prisma migrate deploy
echo "==> Running seed (creates admin if none exist)"
docker compose exec -T server bun run src/db/seed.ts || true

# --- 4. Install host nginx site ---
echo "==> Installing nginx site for $DOMAIN"
NGINX_SITE="deploy/nginx/$DOMAIN.conf"
if [ -f "$NGINX_SITE" ]; then
  sudo cp "$NGINX_SITE" "/etc/nginx/sites-available/$DOMAIN"
  sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
  sudo nginx -t
  sudo systemctl reload nginx
else
  echo "!! nginx site config not found at $NGINX_SITE — skipping nginx setup"
fi

# --- 5. Certbot TLS ---
echo "==> Requesting TLS certificate via certbot"
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || \
  echo "!! certbot failed — run manually: sudo certbot --nginx -d $DOMAIN"

echo ""
echo "==> Done. https://$DOMAIN should now serve Mavino."
echo "    Login with admin / (see .seed-credentials.txt)"
echo ""
echo "==> Setting up daily PostgreSQL backup cron (3am, 14-day retention)"
CRON_LINE="0 3 * * * $REPO_DIR/deploy/backup.sh >> /var/log/mavino-backup.log 2>&1"
if ! crontab -l 2>/dev/null | grep -q "deploy/backup.sh"; then
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "    Added cron entry: $CRON_LINE"
  echo "    Backups go to: $REPO_DIR/backups/"
  echo "    Test manually: $REPO_DIR/deploy/backup.sh"
else
  echo "    Backup cron already configured."
fi
