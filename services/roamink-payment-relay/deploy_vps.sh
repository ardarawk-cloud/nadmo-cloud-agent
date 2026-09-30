#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nadmo/roamink-payment-relay"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE="/etc/systemd/system/nadmo-roamink-payment-relay.service"
DOMAIN="relay.nadmo.id"
APACHE_SITE="/etc/apache2/sites-available/roamink-relay.conf"

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
systemctl enable nadmo-roamink-payment-relay
systemctl restart nadmo-roamink-payment-relay
sleep 2
systemctl is-active --quiet nadmo-roamink-payment-relay
curl -fsS "http://127.0.0.1:8791/api/_healthcheck"
echo

# Nginx was installed during initial relay setup but Apache is the VPS web server.
systemctl disable --now nginx >/dev/null 2>&1 || true

if ! command -v apache2ctl >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq apache2
fi

a2enmod proxy proxy_http headers ssl rewrite >/dev/null

cat > "$APACHE_SITE" <<'APACHE'
<VirtualHost *:80>
    ServerName relay.nadmo.id

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8791/
    ProxyPassReverse / http://127.0.0.1:8791/

    RequestHeader set X-Forwarded-Proto "http"
    ErrorLog ${APACHE_LOG_DIR}/roamink-relay-error.log
    CustomLog ${APACHE_LOG_DIR}/roamink-relay-access.log combined
</VirtualHost>
APACHE

a2ensite roamink-relay.conf >/dev/null
apache2ctl configtest
systemctl enable --now apache2
systemctl reload apache2

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

if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-apache
fi

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
else
  certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
fi

apache2ctl configtest
systemctl reload apache2

curl -fsS "https://$DOMAIN/api/_healthcheck"
echo
curl -fsS "https://$DOMAIN/api/_egress"
echo
