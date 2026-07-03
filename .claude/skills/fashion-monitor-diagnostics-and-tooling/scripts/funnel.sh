#!/usr/bin/env bash
# Run funnel for the last N runs: found -> new -> scored (yes/maybe/no) -> alerted.
# Usage: funnel.sh [db_path] [n_runs]   (defaults: data/fashion_monitor.db, 10)
set -euo pipefail
DB="${1:-data/fashion_monitor.db}"
N="${2:-10}"
[ -f "$DB" ] || { echo "DB not found: $DB" >&2; exit 1; }
sqlite3 -readonly -header -column "$DB" "
SELECT id, started_at, duration_seconds AS dur_s,
       listings_found AS found, listings_new AS new,
       scored_yes AS yes, scored_maybe AS maybe, scored_no AS no,
       alerts_sent AS alerted, had_error AS err
FROM v_run_summary
ORDER BY id DESC LIMIT $N;"
