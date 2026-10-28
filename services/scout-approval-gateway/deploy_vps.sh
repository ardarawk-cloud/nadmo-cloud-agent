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

sudo mkdir -p /etc/nginx/snippets
sudo cp "$APP_DIR/nginx-scout-approval.conf" "$NGINX_SNIPPET"

CONF="$(sudo grep -RIlE "server_name[^;]*agent\.nadmo\.id" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n1 || true)"
if [ -z "$CONF" ]; then
  echo "No nginx server block found for $DOMAIN; creating one"
  CONF="/etc/nginx/sites-available/agent.nadmo.id"
  sudo tee "$CONF" >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name agent.nadmo.id;

    location / {
        return 404;
    }

    include /etc/nginx/snippets/scout-approval-gateway.conf;
}
NGINX
  sudo ln -sf "$CONF" /etc/nginx/sites-enabled/agent.nadmo.id
fi

if ! sudo grep -q "snippets/scout-approval-gateway.conf" "$CONF"; then
  sudo cp "$CONF" "$CONF.scout-approval-backup"
  sudo python3 - "$CONF" <<'PY'
from pathlib import Path
import re, sys
path=Path(sys.argv[1])
s=path.read_text()
m=re.search(r'server_name\s+[^;]*agent\.nadmo\.id[^;]*;', s)
if not m:
    raise SystemExit('agent.nadmo.id server_name not found')
start=s.rfind('server', 0, m.start())
brace=s.find('{', start, m.start()+1)
if start < 0 or brace < 0:
    raise SystemExit('server block start not found')
depth=0
end=None
for i in range(brace, len(s)):
    ch=s[i]
    if ch=='{':
        depth+=1
    elif ch=='}':
        depth-=1
        if depth==0:
            end=i
            break
if end is None:
    raise SystemExit('server block end not found')
insert='\n    include /etc/nginx/snippets/scout-approval-gateway.conf;\n'
s=s[:end]+insert+s[end:]
path.write_text(s)
PY
fi

if ! sudo nginx -t; then
  if [ -f "$CONF.scout-approval-backup" ]; then
    sudo cp "$CONF.scout-approval-backup" "$CONF"
  fi
  sudo nginx -t
  exit 4
fi

if sudo systemctl is-active --quiet nginx; then
  sudo systemctl reload nginx
else
  if ! sudo systemctl enable --now nginx; then
    echo "=== NGINX START FAILURE DIAGNOSTICS ==="
    sudo systemctl --no-pager --full status nginx || true
    sudo journalctl -u nginx --no-pager -n 80 || true
    sudo ss -ltnp | grep -E ':(80|443)\\b' || true
    exit 5
  fi
fi

sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
else
  sudo certbot install --cert-name "$DOMAIN" >/dev/null 2>&1 || true
fi
sudo nginx -t
if sudo systemctl is-active --quiet nginx; then
  sudo systemctl reload nginx
else
  sudo systemctl enable --now nginx
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
