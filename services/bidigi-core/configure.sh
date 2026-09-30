#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="/etc/nadmo/bidigi.env"
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
mkdir -p /etc/nadmo
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"

getv(){ sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
setv(){
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  grep -v "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  install -m 600 "$tmp" "$ENV_FILE"; rm -f "$tmp"
}
echo "BIDIGI provider configuration"
read -r -p "Digiflazz username [$(getv DIGIFLAZZ_USERNAME)]: " DU
DU="${DU:-$(getv DIGIFLAZZ_USERNAME)}"
read -r -s -p "Digiflazz API key (leave blank to keep current): " DK; echo
if [ -n "$DU" ]; then setv DIGIFLAZZ_USERNAME "$DU"; fi
if [ -n "$DK" ]; then setv DIGIFLAZZ_API_KEY "$DK"; fi

read -r -p "Keep Digiflazz testing mode? [Y/n]: " TEST
case "${TEST:-Y}" in n|N|no|NO) setv DIGIFLAZZ_TESTING "false";; *) setv DIGIFLAZZ_TESTING "true";; esac

echo
echo "iPaymu can be left blank until the merchant account is ready."
read -r -p "iPaymu VA [$(getv IPAYMU_VA)]: " VA
VA="${VA:-$(getv IPAYMU_VA)}"
read -r -s -p "iPaymu API key (leave blank to keep current): " IK; echo
if [ -n "$VA" ]; then setv IPAYMU_VA "$VA"; fi
if [ -n "$IK" ]; then setv IPAYMU_API_KEY "$IK"; fi
if [ -n "$VA" ] && { [ -n "$IK" ] || [ -n "$(getv IPAYMU_API_KEY)" ]; }; then
  read -r -p "iPaymu environment sandbox/production [$(getv IPAYMU_ENV)]: " IE
  setv IPAYMU_ENV "${IE:-$(getv IPAYMU_ENV)}"
fi

setv BIDIGI_PUBLIC_BASE "https://bidigi.nadmo.id"
[ -n "$(getv BIDIGI_MARKUP_FLAT)" ] || setv BIDIGI_MARKUP_FLAT "1500"
[ -n "$(getv BIDIGI_MARKUP_PERCENT)" ] || setv BIDIGI_MARKUP_PERCENT "0"
[ -n "$(getv BIDIGI_SYNC_SECONDS)" ] || setv BIDIGI_SYNC_SECONDS "1800"
if [ -z "$(getv BIDIGI_ADMIN_TOKEN)" ]; then
  if command -v openssl >/dev/null 2>&1; then setv BIDIGI_ADMIN_TOKEN "$(openssl rand -hex 24)"; fi
fi

systemctl restart nadmo-bidigi-core
sleep 2
echo
echo "Status:"
curl -fsS http://127.0.0.1:8792/api/_healthcheck; echo
if grep -q '^DIGIFLAZZ_USERNAME=..*' "$ENV_FILE" && grep -q '^DIGIFLAZZ_API_KEY=..*' "$ENV_FILE"; then
  TOKEN="$(getv BIDIGI_ADMIN_TOKEN)"
  echo "Syncing Digiflazz catalog..."
  curl -fsS -X POST -H "X-Admin-Token: $TOKEN" http://127.0.0.1:8792/api/admin/sync; echo
  echo "Checking Digiflazz balance..."
  curl -fsS -H "X-Admin-Token: $TOKEN" http://127.0.0.1:8792/api/admin/balance; echo
fi
echo
echo "Saved securely in $ENV_FILE (mode 600)."
