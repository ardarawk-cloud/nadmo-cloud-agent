#!/usr/bin/env bash
set -euo pipefail

CRON_FILE="/etc/cron.d/nadmo-scout"
LOG_FILE="/opt/nadmo-cloud-agent/logs/scout.log"

echo "=== NADMO Scout Scheduler ==="
if [ -f "$CRON_FILE" ]; then
  cat "$CRON_FILE"
else
  echo "Scheduler not installed."
fi

echo
echo "=== Recent Log ==="
if [ -f "$LOG_FILE" ]; then
  tail -n 60 "$LOG_FILE"
else
  echo "No log file yet."
fi
