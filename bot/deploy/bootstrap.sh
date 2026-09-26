#!/usr/bin/env bash
# Oracle Cloud Ubuntu VM - one-shot setup for the WhatsApp bot.
# Run as the default login user (ubuntu):  bash bootstrap.sh
set -euo pipefail

APP_DIR="/opt/wabot"
APP_USER="${SUDO_USER:-ubuntu}"
APP_HOME=$(eval echo "~${APP_USER}")

echo "==> Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

echo "==> Installing pm2"
npm install -g pm2

echo "==> Preparing app at $APP_DIR"
mkdir -p "$APP_DIR"
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env is missing in $APP_DIR."
  echo "Copy .env.example to .env, put your GEMINI_API_KEY in it, then re-run."
  exit 1
fi
chown "${APP_USER}:${APP_USER}" .env
chmod 600 .env

echo "==> Installing dependencies"
sudo -u "$APP_USER" npm ci --omit=dev

echo "==> Starting bot under pm2"
sudo -u "$APP_USER" pm2 delete wabot >/dev/null 2>&1 || true
sudo -u "$APP_USER" pm2 start index.js --name wabot
sudo -u "$APP_USER" pm2 save

echo "==> Making pm2 survive reboots"
sudo env "PATH=$PATH" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null 2>&1 || true

echo
echo "Done. Next:"
echo "  pm2 logs wabot        <- watch for the QR code and scan it"
echo "  pm2 status            <- confirm it is online"
