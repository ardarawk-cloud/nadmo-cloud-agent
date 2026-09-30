#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nadmo/roamink-payment-relay"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE="/etc/systemd/system/nadmo-roamink-payment-relay.service"
NGINX_SNIPPET="/etc/nginx/snippets/roamink-payment-relay.conf"
DOMAIN="agent.nadmo.id"

mkdir -p "$APP_DIR"
cp "$SRC_DIR/server.py" "$APP_DIR/server.py"
chmod 644 "$APP_DIR/server.py"

cat > "$SERVICE" <<'UNIT'
[Unit]
Description=NADMO ROAMINK iPaymu Payment Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/nadmo/roamink-payment-relay
Environment=PORT=8791
ExecStart=/usr/bin/python3 /opt/nadmo/roamink-payment-relay/server.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now nadmo-roamink-payment-relay
sleep 2
systemctl is-active --quiet nadmo-roamink-payment-relay

mkdir -p /etc/nginx/snippets
cp "$SRC_DIR/nginx-roamink-payment.conf" "$NGINX_SNIPPET"

CONF="$(grep -RIlE "server_name[^;]*agent\.nadmo\.id" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n1 || true)"
if [ -z "$CONF" ]; then
  echo "Could not find existing nginx server block for $DOMAIN"
  exit 3
fi

if ! grep -q "snippets/roamink-payment-relay.conf" "$CONF"; then
  cp "$CONF" "$CONF.roamink-payment-backup"
  python3 - "$CONF" <<'PY'
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
    if s[i]=='{':
        depth+=1
    elif s[i]=='}':
        depth-=1
        if depth==0:
            end=i
            break
if end is None:
    raise SystemExit('server block end not found')
s=s[:end]+'\n    include /etc/nginx/snippets/roamink-payment-relay.conf;\n'+s[end:]
path.write_text(s)
PY
fi

if ! nginx -t; then
  if [ -f "$CONF.roamink-payment-backup" ]; then
    cp "$CONF.roamink-payment-backup" "$CONF"
  fi
  nginx -t
  exit 4
fi

systemctl reload nginx
curl -fsS "http://127.0.0.1:8791/api/_healthcheck"
echo
curl -fsS "https://$DOMAIN/roamink-payment/api/_healthcheck"
echo
curl -fsS "https://$DOMAIN/roamink-payment/api/_egress"
echo
