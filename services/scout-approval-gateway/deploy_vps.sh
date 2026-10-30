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

echo "=== CURRENT WEB LISTENERS ==="
sudo ss -ltnp | grep -E ':(80|443)\\b' || true
sudo systemctl --no-pager --type=service --state=running | grep -Ei 'nginx|apache|caddy|traefik' || true

if sudo systemctl is-active --quiet apache2; then
  echo "Apache detected; configuring Scout through Apache"
  sudo a2enmod proxy proxy_http rewrite ssl headers >/dev/null
  APACHE_CONF="/etc/apache2/sites-available/agent.nadmo.id.conf"
  sudo tee "$APACHE_CONF" >/dev/null <<'APACHE'
<VirtualHost *:80>
    ServerName agent.nadmo.id
    ProxyPreserveHost On
    RewriteEngine On
    RewriteRule ^/scout-approval$ /scout-approval/ [R=301,L]
    ProxyPass /scout-approval/ http://127.0.0.1:8788/
    ProxyPassReverse /scout-approval/ http://127.0.0.1:8788/
</VirtualHost>
APACHE
  sudo mkdir -p /etc/ssl/nadmo-scout
  if [ ! -f /etc/ssl/nadmo-scout/agent.crt ] || [ ! -f /etc/ssl/nadmo-scout/agent.key ]; then
    sudo openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout /etc/ssl/nadmo-scout/agent.key \
      -out /etc/ssl/nadmo-scout/agent.crt \
      -subj "/CN=agent.nadmo.id" \
      -addext "subjectAltName=DNS:agent.nadmo.id"
    sudo chmod 600 /etc/ssl/nadmo-scout/agent.key
  fi

  sudo tee "$APACHE_CONF" >/dev/null <<'APACHE'
<VirtualHost *:80>
    ServerName agent.nadmo.id
    ProxyPreserveHost On
    RewriteEngine On
    RewriteRule ^/scout-approval$ /scout-approval/ [R=301,L]
    ProxyPass /scout-approval/ http://127.0.0.1:8788/
    ProxyPassReverse /scout-approval/ http://127.0.0.1:8788/
</VirtualHost>

<VirtualHost *:443>
    ServerName agent.nadmo.id
    SSLEngine on
    SSLCertificateFile /etc/ssl/nadmo-scout/agent.crt
    SSLCertificateKeyFile /etc/ssl/nadmo-scout/agent.key
    ProxyPreserveHost On
    RewriteEngine On
    RewriteRule ^/scout-approval$ /scout-approval/ [R=301,L]
    ProxyPass /scout-approval/ http://127.0.0.1:8788/
    ProxyPassReverse /scout-approval/ http://127.0.0.1:8788/
</VirtualHost>
APACHE

  sudo a2ensite agent.nadmo.id.conf >/dev/null
  sudo apache2ctl configtest
  sudo systemctl reload apache2
else
  echo "Apache not active; configuring Scout through nginx"
  sudo mkdir -p /etc/nginx/snippets
  sudo cp "$APP_DIR/nginx-scout-approval.conf" "$NGINX_SNIPPET"
  CONF="/etc/nginx/sites-available/agent.nadmo.id"
  sudo tee "$CONF" >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name agent.nadmo.id;
    location / { return 404; }
    include /etc/nginx/snippets/scout-approval-gateway.conf;
}
NGINX
  sudo ln -sf "$CONF" /etc/nginx/sites-enabled/agent.nadmo.id
  sudo nginx -t
  if sudo systemctl is-active --quiet nginx; then
    sudo systemctl reload nginx
  else
    sudo systemctl enable --now nginx
  fi
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  else
    sudo certbot install --cert-name "$DOMAIN" >/dev/null 2>&1 || true
  fi
  sudo nginx -t
  sudo systemctl reload nginx
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

echo "=== INSTALL SCOUT AUTO-APPROVAL ROUTER ==="
sudo install -m 0644 "$APP_DIR/scout-core-overrides/auto-approve.js" "$SCOUT_DIR/src/auto-approve.js"

sudo python3 - "$SCOUT_DIR/.env" "$SCOUT_DIR/package.json" "$SCOUT_DIR/src/notify-discord.js" "$SCOUT_DIR/src/hunt-cli.js" <<'PY'
from pathlib import Path
import json, re, sys

env_path=Path(sys.argv[1])
pkg_path=Path(sys.argv[2])
notify_path=Path(sys.argv[3])
hunt_path=Path(sys.argv[4])

lines=env_path.read_text().splitlines() if env_path.exists() else []
out=[]
seen=False
for line in lines:
    if line.startswith("SCOUT_AUTO_APPROVE="):
        out.append("SCOUT_AUTO_APPROVE=true")
        seen=True
    else:
        out.append(line)
if not seen:
    out.append("SCOUT_AUTO_APPROVE=true")
env_path.write_text("\n".join(out)+"\n")

pkg=json.loads(pkg_path.read_text())
scripts=pkg.setdefault("scripts", {})
scripts["auto:approve"]="node src/auto-approve.js"
scripts["cycle"]="npm run sync:approvals && npm run followup:check && npm run hunt && npm run auto:approve && npm run sync:approvals && npm run notify"
pkg_path.write_text(json.dumps(pkg, indent=2)+"\n")

s=notify_path.read_text()
s=s.replace("**Suggested outreach (manual review):**", "**Suggested outreach:**")
s=s.replace("**Action:** [✅ Approve & WhatsApp]", "**Action:** [📲 Open WhatsApp & Send]")
s=s.replace("**Action:** ☎️ Phone only — call manually.", "**Manual exception:** ☎️ Phone only — call manually.")
s=s.replace(
    "Approve outreach, then update the pipeline stage directly from Discord.",
    "Qualified leads are auto-approved. Use the routed contact action, then update the pipeline stage directly from Discord."
)

if "function emailUrl(" not in s:
    needle='''function whatsappUrl(phone) {
  const digits = normalizeWhatsappMobile(phone);
  return digits ? `https://wa.me/${digits}` : null;
}
'''
    extra='''function whatsappUrl(phone) {
  const digits = normalizeWhatsappMobile(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

function emailUrl(email, draft) {
  if (!email) return null;
  const subject = "Website untuk bisnis Anda — NADMO Studio";
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft)}`;
}

function instagramUrl(instagram) {
  if (!instagram) return null;
  const raw = String(instagram).trim();
  if (/^https?:\\/\\//i.test(raw)) return raw;
  const username = raw
    .replace(/^@/, "")
    .replace(/^instagram\\.com\\//i, "")
    .split(/[/?#]/)[0];
  return username ? `https://instagram.com/${encodeURIComponent(username)}` : null;
}
'''
    s=s.replace(needle, extra)

s=s.replace(
'''  const approveUrl = approveWhatsappUrl(lead, draft);
  const contactedUrl = stageUrl(lead, "CONTACTED");''',
'''  const approveUrl = approveWhatsappUrl(lead, draft);
  const emailAction = emailUrl(lead.email, draft);
  const instagramAction = instagramUrl(lead.instagram);
  const contactedUrl = stageUrl(lead, "CONTACTED");'''
)

old_action='''    approveUrl
      ? `**Action:** [📲 Open WhatsApp & Send](${approveUrl})`
      : lead.phone
        ? "**Manual exception:** ☎️ Phone only — call manually."
        : null,'''
new_action='''    wa ? "**Route:** WHATSAPP" : emailAction ? "**Route:** EMAIL" : instagramAction ? "**Route:** INSTAGRAM" : lead.phone ? "**Route:** PHONE / MANUAL" : null,
    approveUrl
      ? `**Action:** [📲 Open WhatsApp & Send](${approveUrl})`
      : emailAction
        ? `**Action:** [✉️ Open Email Draft](${emailAction})`
        : instagramAction
          ? `**Action:** [📩 Open Instagram](${instagramAction})`
          : lead.phone
            ? "**Manual exception:** ☎️ Phone only — call manually."
            : null,'''
s=s.replace(old_action, new_action)
notify_path.write_text(s)

h=hunt_path.read_text()
h=re.sub(
    r'''const AREAS = \[.*?\];''',
    '''const AREAS = [
  "Denpasar, Bali, Indonesia",
  "Kuta, Bali, Indonesia",
  "Canggu, Bali, Indonesia",
  "Ubud, Bali, Indonesia",
  "Tabanan, Bali, Indonesia"
];''',
    h,
    count=1,
    flags=re.S
)
h=re.sub(
    r'''const CATEGORIES = \[.*?\];''',
    '''const CATEGORIES = [
  "villa",
  "guest house",
  "wedding planner",
  "makeup artist",
  "beauty salon",
  "spa",
  "cafe",
  "restaurant",
  "dentist",
  "car rental"
];''',
    h,
    count=1,
    flags=re.S
)
hunt_path.write_text(h)
PY

curl -kfsS "https://$DOMAIN/scout-approval/api/_healthcheck"
echo
cd "$SCOUT_DIR"
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run sync:approvals
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run auto:approve
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run sync:approvals
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scheduler:install

# Make scheduled cycles inherit the gateway TLS setting and never hang forever.
for CRON_FILE in /etc/cron.d/*; do
  [ -f "$CRON_FILE" ] || continue
  if sudo grep -q "npm run cycle" "$CRON_FILE" 2>/dev/null; then
    if ! sudo grep -q '^NODE_TLS_REJECT_UNAUTHORIZED=' "$CRON_FILE"; then
      sudo sed -i '/^PATH=/a NODE_TLS_REJECT_UNAUTHORIZED=0' "$CRON_FILE"
    fi
    sudo sed -i 's#/usr/bin/npm run cycle#/usr/bin/timeout 1200 /usr/bin/npm run cycle#g' "$CRON_FILE"
  fi
done

NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scheduler:status

echo "=== FOLLOWUP / DISCORD SMOKE ==="
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run followup:check
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run notify:status

echo "=== NADMO SCOUT CORE RUNTIME CHECK ==="
node -e "const p=require('./package.json'); console.log(JSON.stringify({name:p.name,version:p.version,scripts:p.scripts},null,2))" || true
find src -maxdepth 1 -type f -printf '%f\n' 2>/dev/null | sort | sed -n '1,120p' || true
sudo systemctl --no-pager --type=service --all | grep -Ei 'nadmo|scout' || true
if command -v pm2 >/dev/null 2>&1; then pm2 jlist || true; fi
crontab -l 2>/dev/null | grep -Ei 'nadmo|scout|lead|summary|follow' || true

echo "Scout Approval Gateway migrated successfully"
