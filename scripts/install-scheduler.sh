#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nadmo-cloud-agent"
LOG_DIR="$APP_DIR/logs"
CRON_FILE="/etc/cron.d/nadmo-scout"

mkdir -p "$LOG_DIR"
chmod +x "$APP_DIR/scripts/run-daily-summary.sh"

cat > "$CRON_FILE" <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 */6 * * * root cd /opt/nadmo-cloud-agent && /usr/bin/flock -n /tmp/nadmo-scout.lock /usr/bin/npm run cycle >> /opt/nadmo-cloud-agent/logs/scout.log 2>&1
15 * * * * root /usr/bin/flock -n /tmp/nadmo-summary.lock /bin/bash /opt/nadmo-cloud-agent/scripts/run-daily-summary.sh >> /opt/nadmo-cloud-agent/logs/summary.log 2>&1
EOF

chmod 644 "$CRON_FILE"

echo "NADMO Scout scheduler installed."
echo "Scout cycle: every 6 hours."
echo "Daily pipeline summary target: 08:15 WITA (timezone-safe gate)."
echo "Server timezone: $(date +%Z' '%z)"
echo "Current WITA: $(TZ=Asia/Makassar date '+%Y-%m-%d %H:%M %Z %z')"
echo "Scout log: $LOG_DIR/scout.log"
echo "Summary log: $LOG_DIR/summary.log"
