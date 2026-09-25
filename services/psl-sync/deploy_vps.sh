#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nadmo/psl-sync"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
NGINX_SNIPPET="/etc/nginx/snippets/psl-sync.conf"
DOMAIN="agent.nadmo.id"

if [ -z "${PSL_SYNC_CODE:-}" ]; then
  echo "PSL_SYNC_CODE is required"
  exit 2
fi

sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete "$SRC_DIR/" "$APP_DIR/"
printf 'PSL_SYNC_CODE=%s\nPSL_DB_PATH=/data/papa-sauce-lab.sqlite3\n' "$PSL_SYNC_CODE" | sudo tee "$APP_DIR/.env" >/dev/null
sudo chmod 600 "$APP_DIR/.env"

cd "$APP_DIR"
sudo docker compose up -d --build

sudo mkdir -p /etc/nginx/snippets
sudo cp "$APP_DIR/nginx-psl-sync.conf" "$NGINX_SNIPPET"

CONF="$(sudo grep -RIlE "server_name[^;]*agent\.nadmo\.id" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n1 || true)"
if [ -z "$CONF" ]; then
  echo "Could not find existing nginx server block for $DOMAIN"
  exit 3
fi

if ! sudo grep -q "snippets/psl-sync.conf" "$CONF"; then
  sudo cp "$CONF" "$CONF.psl-backup"
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
indent='    '
insert='\n'+indent+'include /etc/nginx/snippets/psl-sync.conf;\n'
s=s[:end]+insert+s[end:]
path.write_text(s)
PY
fi

if ! sudo nginx -t; then
  if [ -f "$CONF.psl-backup" ]; then
    sudo cp "$CONF.psl-backup" "$CONF"
  fi
  sudo nginx -t
  exit 4
fi

sudo systemctl reload nginx
curl -fsS "https://$DOMAIN/psl-sync/health"
echo
echo "PSL sync deployed successfully"
