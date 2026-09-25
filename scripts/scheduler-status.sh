#!/usr/bin/env bash
set -euo pipefail

CRON_FILE="/etc/cron.d/nadmo-scout"
SCOUT_LOG="/opt/nadmo-cloud-agent/logs/scout.log"
SUMMARY_LOG="/opt/nadmo-cloud-agent/logs/summary.log"
STATE_FILE="/opt/nadmo-cloud-agent/.last-pipeline-summary-wita"

echo "=== NADMO Scout Scheduler ==="
echo "Server time: $(date '+%Y-%m-%d %H:%M:%S %Z %z')"
echo "WITA time:   $(TZ=Asia/Makassar date '+%Y-%m-%d %H:%M:%S %Z %z')"
if [ -f "$STATE_FILE" ]; then
  echo "Last daily summary (WITA date): $(cat "$STATE_FILE")"
else
  echo "Last daily summary (WITA date): none recorded by timezone-safe runner"
fi

echo
if [ -f "$CRON_FILE" ]; then
  cat "$CRON_FILE"
else
  echo "Scheduler not installed."
fi

echo
echo "=== Recent Scout Log ==="
if [ -f "$SCOUT_LOG" ]; then
  tail -n 40 "$SCOUT_LOG"
else
  echo "No scout log file yet."
fi

echo
echo "=== Recent Summary Log ==="
if [ -f "$SUMMARY_LOG" ]; then
  tail -n 40 "$SUMMARY_LOG"
else
  echo "No summary log file yet."
fi
