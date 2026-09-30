#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/nadmo/bidigi-core"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_DIR="/etc/nadmo"; ENV_FILE="$ENV_DIR/bidigi.env"
DATA_DIR="/var/lib/nadmo"
DOMAIN="bidigi.nadmo.id"
UPSTREAM="https://bidigi-shop.ardarawk.chatgpt.site"
SERVICE="/etc/systemd/system/nadmo-bidigi-core.service"
SITE="/etc/apache2/sites-available/bidigi.conf"

mkdir -p "$APP_DIR" "$ENV_DIR" "$DATA_DIR"
install -m 0644 "$SRC_DIR/server.py" "$APP_DIR/server.py"
install -m 0644 "$SRC_DIR/bidigi-live.js" "$APP_DIR/bidigi-live.js"

if [ ! -f "$ENV_FILE" ]; then
cat > "$ENV_FILE" <<'ENV'
# BIDIGI secrets - root only, never commit.
DIGIFLAZZ_USERNAME=
DIGIFLAZZ_API_KEY=
DIGIFLAZZ_WEBHOOK_SECRET=
DIGIFLAZZ_TESTING=true
IPAYMU_ENV=sandbox
IPAYMU_VA=
IPAYMU_API_KEY=
BIDIGI_MARKUP_FLAT=1500
BIDIGI_MARKUP_PERCENT=0
BIDIGI_SYNC_SECONDS=1800
BIDIGI_ADMIN_TOKEN=
BIDIGI_PUBLIC_BASE=https://bidigi.nadmo.id
ENV
fi
chmod 600 "$ENV_FILE"

cat > "$SERVICE" <<'UNIT'
[Unit]
Description=NADMO BIDIGI Core
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=root
WorkingDirectory=/opt/nadmo/bidigi-core
Environment=PORT=8792
Environment=BIDIGI_DB=/var/lib/nadmo/bidigi.db
EnvironmentFile=-/etc/nadmo/bidigi.env
ExecStart=/usr/bin/python3 /opt/nadmo/bidigi-core/server.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable nadmo-bidigi-core >/dev/null
systemctl restart nadmo-bidigi-core
for n in $(seq 1 15); do
  curl -fsS http://127.0.0.1:8792/api/_healthcheck >/dev/null && break
  [ "$n" -lt 15 ] || { journalctl -u nadmo-bidigi-core -n 100 --no-pager; exit 4; }
  sleep 1
done

if ! command -v apache2ctl >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq apache2
fi
a2enmod proxy proxy_http proxy_connect ssl headers rewrite filter substitute >/dev/null

cat > "$SITE" <<APACHE
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost Off
    SSLProxyEngine On
    RequestHeader unset Accept-Encoding

    ProxyPass /api/ http://127.0.0.1:8792/api/ nocanon
    ProxyPassReverse /api/ http://127.0.0.1:8792/api/

    ProxyPass /bidigi-live.js !
    Alias /bidigi-live.js $APP_DIR/bidigi-live.js
    <Directory $APP_DIR>
        Require all granted
    </Directory>

    ProxyPass / $UPSTREAM/ nocanon
    ProxyPassReverse / $UPSTREAM/

    <Location />
        AddOutputFilterByType SUBSTITUTE text/html
        Substitute "s|</body>|<script defer src=\"/bidigi-live.js\"></script></body>|ni"
    </Location>

    ErrorLog /var/log/apache2/bidigi-error.log
    CustomLog /var/log/apache2/bidigi-access.log combined
</VirtualHost>
APACHE

a2ensite bidigi.conf >/dev/null
apache2ctl configtest
systemctl enable --now apache2 >/dev/null
systemctl reload apache2

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi
curl -fsS --max-time 30 "$UPSTREAM/" >/dev/null

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

echo "=== HEALTH ==="
curl -fsS "https://$DOMAIN/api/_healthcheck"; echo
echo "=== EGRESS ==="
curl -fsS "https://$DOMAIN/api/_egress"; echo
echo "=== STOREFRONT ==="
curl -fsS "https://$DOMAIN/" | grep -q 'BIDIGI' && echo "BIDIGI storefront OK"
curl -fsS "https://$DOMAIN/" | grep -q '/bidigi-live.js' && echo "BIDIGI live bridge injected"
