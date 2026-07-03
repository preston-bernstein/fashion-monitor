#!/usr/bin/env bash
# F2 (query-generation intelligence) step 1: flag queries as needs_revision —
# report only, never mutates scrape_queries/search_groups.
# Underperforming = enough history to judge (>= MIN_RUNS runs), enough volume
# to matter (>= MIN_NEW new listings), and a yes_rate that's zero/near-zero or
# NULL (every scored listing came back NO, or nothing has been scored at all
# despite listings_new > 0 — a prefilter/query-wording problem either way).
# Usage: needs-revision.sh [db_path] [min_runs] [min_new] [max_yes_rate]
set -euo pipefail
DB="${1:-data/fashion_monitor.db}"
MIN_RUNS="${2:-5}"
MIN_NEW="${3:-10}"
MAX_YES_RATE="${4:-0.15}"
[ -f "$DB" ] || { echo "DB not found: $DB" >&2; exit 1; }
sqlite3 -readonly -header -column "$DB" "
SELECT profile_id, query_id, group_id, platform, query_text, total_runs,
       listings_new, scored_yes, scored_maybe, scored_no, yes_rate
FROM v_query_scorecard
WHERE total_runs >= $MIN_RUNS
  AND listings_new >= $MIN_NEW
  AND (yes_rate IS NULL OR yes_rate <= $MAX_YES_RATE)
ORDER BY listings_new DESC;"
