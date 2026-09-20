#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nadmo-cloud-agent"
LOG_DIR="$APP_DIR/logs"
CRON_FILE="/etc/cron.d/nadmo-scout"

mkdir -p "$LOG_DIR"

cat > "$CRON_FILE" <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 */6 * * * root cd /opt/nadmo-cloud-agent && /usr/bin/flock -n /tmp/nadmo-scout.lock /usr/bin/npm run cycle >> /opt/nadmo-cloud-agent/logs/scout.log 2>&1
EOF

chmod 644 "$CRON_FILE"

echo "NADMO Scout scheduler installed."
echo "Schedule: every 6 hours"
echo "Log: $LOG_DIR/scout.log"
