#!/usr/bin/env bash
# PENDING backlog: listings awaiting LLM scoring (LLM was unreachable).
# Usage: pending-backlog.sh [db_path]   (default: data/fashion_monitor.db)
set -euo pipefail
DB="${1:-data/fashion_monitor.db}"
[ -f "$DB" ] || { echo "DB not found: $DB" >&2; exit 1; }
sqlite3 -readonly -header -column "$DB" "
SELECT profile_id, platform, COUNT(*) AS pending, MIN(first_seen) AS oldest
FROM seen_listings
WHERE score = 'PENDING'
GROUP BY profile_id, platform
ORDER BY pending DESC;"
echo "---"
sqlite3 -readonly "$DB" "SELECT 'total_pending=' || COUNT(*) FROM seen_listings WHERE score='PENDING';"
