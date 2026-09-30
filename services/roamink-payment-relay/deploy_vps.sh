#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nadmo/roamink-payment-relay"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE="/etc/systemd/system/nadmo-roamink-payment-relay.service"
DOMAIN="relay.nadmo.id"
NGINX_SITE="/etc/nginx/sites-available/roamink-relay"
NGINX_LINK="/etc/nginx/sites-enabled/roamink-relay"

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
curl -fsS "http://127.0.0.1:8791/api/_healthcheck"
echo

if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
fi

cat > "$NGINX_SITE" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name relay.nadmo.id;

    client_max_body_size 64k;

    location / {
        proxy_pass http://127.0.0.1:8791;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

ln -sfn "$NGINX_SITE" "$NGINX_LINK"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

for attempt in $(seq 1 12); do
  if getent ahosts "$DOMAIN" >/dev/null 2>&1; then
    break
  fi
  [ "$attempt" -lt 12 ] || { echo "DNS for $DOMAIN not ready"; exit 5; }
  sleep 10
done

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
fi

nginx -t
systemctl reload nginx

curl -fsS "https://$DOMAIN/api/_healthcheck"
echo
curl -fsS "https://$DOMAIN/api/_egress"
echo
