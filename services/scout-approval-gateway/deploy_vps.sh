#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nadmo/scout-approval-gateway"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
NGINX_SNIPPET="/etc/nginx/snippets/scout-approval-gateway.conf"
DOMAIN="agent.nadmo.id"
SCOUT_DIR="/opt/nadmo-cloud-agent"
NEW_BASE="https://agent.nadmo.id/scout-approval"

sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude data "$SRC_DIR/" "$APP_DIR/"
sudo mkdir -p "$APP_DIR/data"

cd "$APP_DIR"
if command -v docker >/dev/null 2>&1; then
  sudo docker compose up -d --build
else
  echo "Docker not found; installing Scout as systemd service"
  sudo tee /etc/systemd/system/nadmo-scout-approval-gateway.service >/dev/null <<'UNIT'
[Unit]
Description=NADMO Scout Approval Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/nadmo/scout-approval-gateway
Environment=PORT=8788
Environment=DB_PATH=/opt/nadmo/scout-approval-gateway/data/scout-approval.sqlite3
ExecStart=/usr/bin/python3 /opt/nadmo/scout-approval-gateway/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable --now nadmo-scout-approval-gateway.service
  sudo systemctl restart nadmo-scout-approval-gateway.service
  sudo systemctl --no-pager --full status nadmo-scout-approval-gateway.service | head -n 30
fi

echo "=== CURRENT WEB LISTENERS ==="
sudo ss -ltnp | grep -E ':(80|443)\\b' || true
sudo systemctl --no-pager --type=service --state=running | grep -Ei 'nginx|apache|caddy|traefik' || true

if sudo systemctl is-active --quiet apache2; then
  echo "Apache detected; configuring Scout through Apache"
  sudo a2enmod proxy proxy_http rewrite ssl headers >/dev/null
  APACHE_CONF="/etc/apache2/sites-available/agent.nadmo.id.conf"
  sudo tee "$APACHE_CONF" >/dev/null <<'APACHE'
<VirtualHost *:80>
    ServerName agent.nadmo.id
    ProxyPreserveHost On
    RewriteEngine On
    RewriteRule ^/scout-approval$ /scout-approval/ [R=301,L]
    ProxyPass /scout-approval/ http://127.0.0.1:8788/
    ProxyPassReverse /scout-approval/ http://127.0.0.1:8788/
</VirtualHost>
APACHE
  sudo a2ensite agent.nadmo.id.conf >/dev/null
  sudo apache2ctl configtest
  sudo systemctl reload apache2

  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-apache
  if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    sudo certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  else
    sudo certbot install --cert-name "$DOMAIN" >/dev/null 2>&1 || true
  fi
  sudo apache2ctl configtest
  sudo systemctl reload apache2
else
  echo "Apache not active; configuring Scout through nginx"
  sudo mkdir -p /etc/nginx/snippets
  sudo cp "$APP_DIR/nginx-scout-approval.conf" "$NGINX_SNIPPET"
  CONF="/etc/nginx/sites-available/agent.nadmo.id"
  sudo tee "$CONF" >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name agent.nadmo.id;
    location / { return 404; }
    include /etc/nginx/snippets/scout-approval-gateway.conf;
}
NGINX
  sudo ln -sf "$CONF" /etc/nginx/sites-enabled/agent.nadmo.id
  sudo nginx -t
  if sudo systemctl is-active --quiet nginx; then
    sudo systemctl reload nginx
  else
    sudo systemctl enable --now nginx
  fi
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  else
    sudo certbot install --cert-name "$DOMAIN" >/dev/null 2>&1 || true
  fi
  sudo nginx -t
  sudo systemctl reload nginx
fi

if [ -f "$SCOUT_DIR/.env" ]; then
  sudo python3 - "$SCOUT_DIR/.env" "$NEW_BASE" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1])
base=sys.argv[2]
lines=path.read_text().splitlines()
out=[]
found=False
for line in lines:
    if line.startswith('SCOUT_APPROVAL_BASE_URL='):
        out.append('SCOUT_APPROVAL_BASE_URL='+base)
        found=True
    else:
        out.append(line)
if not found:
    out.append('SCOUT_APPROVAL_BASE_URL='+base)
path.write_text('\n'.join(out)+'\n')
PY
else
  printf 'SCOUT_APPROVAL_BASE_URL=%s\n' "$NEW_BASE" | sudo tee "$SCOUT_DIR/.env" >/dev/null
fi

curl -fsS "https://$DOMAIN/scout-approval/api/_healthcheck"
echo
cd "$SCOUT_DIR"
npm run sync:approvals
echo "Scout Approval Gateway migrated successfully"
