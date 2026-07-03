#!/usr/bin/env bash
# Monitor scorecard: per search group, rollup of runs/listings/alerts/feedback.
# Usage: scorecard.sh [db_path]   (default: data/fashion_monitor.db)
set -euo pipefail
DB="${1:-data/fashion_monitor.db}"
[ -f "$DB" ] || { echo "DB not found: $DB" >&2; exit 1; }
sqlite3 -readonly -header -column "$DB" "SELECT * FROM v_search_group_scorecard;"
echo "--- per-platform breakdown (worst yes_rate first) ---"
sqlite3 -readonly -header -column "$DB" "
SELECT * FROM v_query_scorecard ORDER BY yes_rate ASC LIMIT 20;"
