#!/usr/bin/env bash
# External-dependency health: 7-day uptime per integration + recent failures.
# Usage: integration-health.sh [db_path]   (default: data/fashion_monitor.db)
set -euo pipefail
DB="${1:-data/fashion_monitor.db}"
[ -f "$DB" ] || { echo "DB not found: $DB" >&2; exit 1; }
echo "--- 7-day uptime ---"
sqlite3 -readonly -header -column "$DB" "SELECT * FROM v_integration_uptime_7d;"
echo "--- recent failures ---"
sqlite3 -readonly -header -column "$DB" "SELECT * FROM v_integration_recent_failures LIMIT 20;"
