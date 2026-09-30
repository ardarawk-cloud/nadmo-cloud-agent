#!/usr/bin/env bash
set -euo pipefail
DOMAIN="bidigi.nadmo.id"
EXPECTED="151.243.222.93"

echo "Checking DNS for $DOMAIN..."
RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
echo "resolved=$RESOLVED"
if [ "$RESOLVED" != "$EXPECTED" ]; then
  echo "BIDIGI_DOMAIN_NOT_ON_VPS: expected $EXPECTED"
  exit 20
fi

curl -fsS -H "Host: $DOMAIN" http://127.0.0.1/api/_healthcheck | grep -q '"service":"bidigi-core"'

if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-apache
fi
certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
apache2ctl configtest
systemctl reload apache2

curl -fsS --max-time 30 "https://$DOMAIN/api/_healthcheck" | grep -q '"service":"bidigi-core"'
curl -fsS --max-time 30 "https://$DOMAIN/" | grep -q '/bidigi-live.js'
echo "BIDIGI_DOMAIN_ACTIVE"
