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
install -m 0755 "$SRC_DIR/configure.sh" "$APP_DIR/configure.sh"

if [ ! -f "$ENV_FILE" ]; then
cat > "$ENV_FILE" <<'ENV'
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
a2enmod proxy proxy_http proxy_connect ssl headers rewrite filter substitute alias >/dev/null
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

echo "=== BIDIGI ORIGIN HEALTH ==="
curl -fsS http://127.0.0.1:8792/api/_healthcheck; echo
echo "=== BIDIGI EGRESS ==="
curl -fsS http://127.0.0.1:8792/api/_egress; echo
echo "=== BIDIGI ORIGIN STOREFRONT ==="
PAGE="$(curl -fsS -H "Host: $DOMAIN" http://127.0.0.1/)"
echo "$PAGE" | grep -q 'BIDIGI' && echo "BIDIGI storefront OK"
echo "$PAGE" | grep -q '/bidigi-live.js' && echo "BIDIGI live bridge injected"

# The current public hostname can still be attached to the old ChatGPT Site at Cloudflare.
# Do not fail deployment because of that routing state.
echo "=== PUBLIC ROUTE ==="
CODE="$(curl -sS -o /tmp/bidigi-public-check -w '%{http_code}' --max-time 20 https://$DOMAIN/api/_healthcheck || true)"
echo "public_health_http=$CODE"
if grep -q '"service":"bidigi-core"' /tmp/bidigi-public-check 2>/dev/null; then
  echo "public_route=bidigi-core"
else
  echo "public_route=pending-cloudflare-switch"
fi
