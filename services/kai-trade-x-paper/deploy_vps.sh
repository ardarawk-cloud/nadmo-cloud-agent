#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/kai-trade-x"
STATE_ROOT="/var/lib/kai-trade-x"
SERVICE_NAME="kai-trade-x-paper"
SERVICE_USER="kaitrade"
PORT="8787"
RELEASE_SHA="${KAI_RELEASE_SHA:-manual-$(date +%Y%m%d%H%M%S)}"
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$APP_ROOT/releases/$RELEASE_SHA"

if [ "$(id -u)" -ne 0 ]; then
  echo "This installer must run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3.12 python3.12-venv curl ca-certificates

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -m 0755 "$APP_ROOT/releases" "$STATE_ROOT" "$RELEASE_DIR"
cp -a "$SRC_ROOT/backend" "$RELEASE_DIR/backend"

if [ ! -x "$APP_ROOT/venv/bin/python" ]; then
  python3.12 -m venv "$APP_ROOT/venv"
fi

"$APP_ROOT/venv/bin/python" -m pip install --upgrade pip >/dev/null
"$APP_ROOT/venv/bin/pip" install -r "$RELEASE_DIR/backend/requirements.txt" >/dev/null

ln -sfn "$RELEASE_DIR" "$APP_ROOT/current"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_ROOT" "$STATE_ROOT"

cat >"/etc/systemd/system/$SERVICE_NAME.service" <<'UNIT'
[Unit]
Description=KAI TRADE X PAPER AUTO
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kaitrade
Group=kaitrade
WorkingDirectory=/opt/kai-trade-x/current/backend

Environment=PYTHONPATH=.
Environment=TRADING_MODE=PAPER
Environment=LIVE_TRADING_ENABLED=false
Environment=BROKER_VERIFIED=false
Environment=BROKER_SAFETY_TESTS_PASSED=false
Environment=PAPER_STATE_FILE=/var/lib/kai-trade-x/paper_state.json
Environment=PAPER_LOSS_LOCK_COOLDOWN_HOURS=24

ExecStart=/opt/kai-trade-x/venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8787

Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/var/lib/kai-trade-x

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME"

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/tmp/kai-health.json 2>/dev/null; then
    break
  fi
  sleep 2
done

HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/health")"
SAFETY="$(curl -fsS "http://127.0.0.1:$PORT/system/safety")"
AUTO="$(curl -fsS "http://127.0.0.1:$PORT/paper/auto")"

echo "$HEALTH"
echo "$SAFETY"
echo "$AUTO"

echo "$HEALTH" | grep -q '"status":"SYSTEM_ONLINE"'
echo "$HEALTH" | grep -q '"version":"0.8.0"'
echo "$HEALTH" | grep -q '"trading_mode":"PAPER"'
echo "$HEALTH" | grep -q '"live_execution_allowed":false'
echo "$AUTO" | grep -q '"running":true'
echo "$AUTO" | grep -q '"loss_lock_cooldown_hours":24'

PUBLIC_HOST="kaitrade.nadmo.id"
ACME_ROOT="/var/www/kaitrade-acme"
APACHE_SITE="/etc/apache2/sites-available/kaitrade.conf"

apt-get install -y -qq apache2 certbot >/dev/null
a2enmod proxy proxy_http headers rewrite ssl >/dev/null 2>&1 || true
install -d -m 0755 "$ACME_ROOT/.well-known/acme-challenge"

cat >"$APACHE_SITE" <<APACHE
<VirtualHost *:80>
    ServerName $PUBLIC_HOST
    DocumentRoot $ACME_ROOT

    ProxyPass /.well-known/acme-challenge/ !
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:$PORT/ nocanon
    ProxyPassReverse / http://127.0.0.1:$PORT/

    RequestHeader set X-Forwarded-Proto "http"
    ErrorLog ${APACHE_LOG_DIR}/kaitrade-error.log
    CustomLog ${APACHE_LOG_DIR}/kaitrade-access.log combined
</VirtualHost>
APACHE

a2ensite kaitrade.conf >/dev/null 2>&1 || true
apache2ctl configtest
systemctl reload apache2

if [ ! -s "/etc/letsencrypt/live/$PUBLIC_HOST/fullchain.pem" ]; then
  for _ in $(seq 1 30); do
    if getent ahostsv4 "$PUBLIC_HOST" | awk '{print $1}' | grep -qx '151.243.222.93'; then
      break
    fi
    sleep 2
  done
  getent ahostsv4 "$PUBLIC_HOST" | awk '{print $1}' | grep -qx '151.243.222.93'
  certbot certonly --webroot -w "$ACME_ROOT" -d "$PUBLIC_HOST" --non-interactive --agree-tos --register-unsafely-without-email
fi

cat >"$APACHE_SITE" <<APACHE
<VirtualHost *:80>
    ServerName $PUBLIC_HOST
    DocumentRoot $ACME_ROOT

    ProxyPass /.well-known/acme-challenge/ !
    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/.well-known/acme-challenge/
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]

    ErrorLog ${APACHE_LOG_DIR}/kaitrade-error.log
    CustomLog ${APACHE_LOG_DIR}/kaitrade-access.log combined
</VirtualHost>

<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName $PUBLIC_HOST

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/$PUBLIC_HOST/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$PUBLIC_HOST/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:$PORT/ nocanon
    ProxyPassReverse / http://127.0.0.1:$PORT/
    RequestHeader set X-Forwarded-Proto "https"

    ErrorLog ${APACHE_LOG_DIR}/kaitrade-error.log
    CustomLog ${APACHE_LOG_DIR}/kaitrade-access.log combined
</VirtualHost>
</IfModule>
APACHE

apache2ctl configtest
systemctl reload apache2

PUBLIC_HEALTH="$(curl -fsS --resolve "$PUBLIC_HOST:443:127.0.0.1" "https://$PUBLIC_HOST/health")"
echo "$PUBLIC_HEALTH"
echo "$PUBLIC_HEALTH" | grep -q '"status":"SYSTEM_ONLINE"'
echo "$PUBLIC_HEALTH" | grep -q '"version":"0.8.0"'
echo "$PUBLIC_HEALTH" | grep -q '"live_execution_allowed":false'

echo "KAI_DEPLOY_OK release=$RELEASE_SHA service=$SERVICE_NAME port=$PORT public=https://$PUBLIC_HOST"
