#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/nadmo-cloud-agent"
STATE_FILE="$APP_DIR/.last-pipeline-summary-wita"
NOW_WITA="$(TZ=Asia/Makassar date +%H:%M)"
TODAY_WITA="$(TZ=Asia/Makassar date +%F)"

# Cron invokes this at minute 15 of every server-local hour.
# Only the 08:15 WITA invocation is allowed to publish the daily summary.
if [ "$NOW_WITA" != "08:15" ]; then
  exit 0
fi

if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$TODAY_WITA" ]; then
  exit 0
fi

cd "$APP_DIR"
/usr/bin/npm run pipeline:summary
printf '%s\n' "$TODAY_WITA" > "$STATE_FILE"
